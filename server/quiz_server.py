"""Swack quiz backend: stdlib-only HTTP JSON API over sqlite.

Quiz configs are JSON files in the --quizzes directory (slug = filename stem);
the answer key stays server-side and never appears in any response. A POST ACK
means the answer row is committed to sqlite. Scores are computed at read time
from the current config, so fixing an answer key rescores past answers.
"""

from __future__ import annotations

import argparse
import hmac
import json
import re
import sqlite3
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

DIRECTIONS = ("Left", "Right", "Up", "Down")
FEEDBACK_MODES = ("none", "instant", "final", "both")
VISIBILITIES = ("none", "done", "always")
NAME_MODES = ("disabled", "required")

MAX_BODY_BYTES = 16 * 1024
MAX_SESSION_ID_LEN = 64
MAX_NAME_LEN = 120

SLUG_RE = re.compile(r"^[a-z0-9-]{1,40}$")
SESSION_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
ROUTE_RE = re.compile(r"^/api/quiz/([a-z0-9-]{1,40})(?:/(session/([A-Za-z0-9-]{8,64})|leaderboard|export|answer))?$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS answers (
	quiz TEXT NOT NULL,
	generation INTEGER NOT NULL,
	session_id TEXT NOT NULL,
	q_index INTEGER NOT NULL,
	answer TEXT NOT NULL,
	name TEXT NOT NULL,
	client_ts INTEGER NOT NULL,
	received_ts INTEGER NOT NULL,
	PRIMARY KEY (quiz, generation, session_id, q_index)
) WITHOUT ROWID;
"""


class ApiError(Exception):
	def __init__(self, status: int, message: str):
		super().__init__(message)
		self.status = status
		self.message = message


@dataclass(frozen=True)
class LeaderboardConfig:
	top_n: int = 3
	show_points: bool = False
	visibility: str = "done"


@dataclass(frozen=True)
class QuizConfig:
	slug: str
	name: str
	questions: tuple[str, ...]
	correct: tuple[str | None, ...]
	labels: dict[str, str]
	randomize_order: bool
	name_mode: str
	name_prefill: bool
	name_prompt: str
	feedback: str
	leaderboard: LeaderboardConfig
	export_token: str | None
	generation: int


@dataclass(frozen=True)
class AnswerRow:
	generation: int
	session_id: str
	q_index: int
	answer: str
	name: str
	client_ts: int
	received_ts: int


@dataclass(frozen=True)
class SessionStat:
	session_id: str
	name: str
	score: int
	answered: int
	last_ts: int


def parse_quiz_config(slug: str, raw: dict[str, Any]) -> QuizConfig:
	if not SLUG_RE.match(slug):
		raise ValueError(f"invalid quiz slug: {slug!r}")
	questions = raw.get("questions")
	if not isinstance(questions, list) or not questions:
		raise ValueError(f"{slug}: questions must be a non-empty list")
	texts: list[str] = []
	correct: list[str | None] = []
	for i, q in enumerate(questions):
		if not isinstance(q, dict) or not isinstance(q.get("text"), str) or not q["text"].strip():
			raise ValueError(f"{slug}: question {i} needs a non-empty text")
		c = q.get("correct")
		if c is not None and c not in DIRECTIONS:
			raise ValueError(f"{slug}: question {i} correct must be one of {DIRECTIONS} or null")
		texts.append(q["text"])
		correct.append(c)
	labels_raw = raw.get("labels", {})
	labels = {d: str(labels_raw.get(d, "")) for d in ("left", "right", "up", "down")}
	if not any(labels.values()):
		raise ValueError(f"{slug}: at least one direction label must be non-empty")
	for i, c in enumerate(correct):
		if c is not None and labels[c.lower()] == "":
			raise ValueError(f"{slug}: question {i} correct direction {c} is disabled")
	feedback = raw.get("feedback", "none")
	if feedback not in FEEDBACK_MODES:
		raise ValueError(f"{slug}: feedback must be one of {FEEDBACK_MODES}")
	name_mode = raw.get("nameMode", "required")
	if name_mode not in NAME_MODES:
		raise ValueError(f"{slug}: nameMode must be one of {NAME_MODES}")
	name_prompt = raw.get("namePrompt", "What's your name?")
	if not isinstance(name_prompt, str) or not name_prompt.strip():
		raise ValueError(f"{slug}: namePrompt must be a non-empty string")
	lb_raw = raw.get("leaderboard", {})
	lb = LeaderboardConfig(
		top_n=int(lb_raw.get("topN", 3)),
		show_points=bool(lb_raw.get("showPoints", False)),
		visibility=lb_raw.get("visibility", "done"),
	)
	if lb.visibility not in VISIBILITIES:
		raise ValueError(f"{slug}: leaderboard visibility must be one of {VISIBILITIES}")
	if lb.top_n < 1:
		raise ValueError(f"{slug}: leaderboard topN must be >= 1")
	token = raw.get("exportToken")
	if token is not None and (not isinstance(token, str) or len(token) < 8):
		raise ValueError(f"{slug}: exportToken must be a string of >= 8 chars")
	generation = raw.get("generation", 0)
	if not isinstance(generation, int) or generation < 0:
		raise ValueError(f"{slug}: generation must be a non-negative integer")
	return QuizConfig(
		slug=slug,
		name=str(raw.get("name", slug)),
		questions=tuple(texts),
		correct=tuple(correct),
		labels=labels,
		randomize_order=bool(raw.get("randomizeOrder", True)),
		name_mode=name_mode,
		name_prefill=bool(raw.get("namePrefill", True)),
		name_prompt=name_prompt,
		feedback=feedback,
		leaderboard=lb,
		export_token=token,
		generation=generation,
	)


class QuizRegistry:
	"""Loads quiz configs from a directory; strict at startup, but a broken
	edit while running keeps serving the last good config instead of taking
	the quiz down."""

	def __init__(self, quizzes_dir: Path):
		self.dir = quizzes_dir
		self._cache: dict[str, tuple[float, QuizConfig]] = {}
		self._lock = threading.Lock()
		for path in sorted(self.dir.glob("*.json")):
			cfg = parse_quiz_config(path.stem, json.loads(path.read_text()))
			self._cache[path.stem] = (path.stat().st_mtime, cfg)
		if not self._cache:
			raise ValueError(f"no quiz configs found in {self.dir}")

	@property
	def slugs(self) -> list[str]:
		return sorted(self._cache)

	def get(self, slug: str) -> QuizConfig | None:
		if not SLUG_RE.match(slug):
			return None
		path = self.dir / f"{slug}.json"
		with self._lock:
			cached = self._cache.get(slug)
			try:
				mtime = path.stat().st_mtime
			except OSError:
				return cached[1] if cached else None
			if cached and cached[0] == mtime:
				return cached[1]
			try:
				cfg = parse_quiz_config(slug, json.loads(path.read_text()))
			except (ValueError, json.JSONDecodeError) as e:
				print(f"quiz config reload failed, keeping previous: {e}", flush=True)
				return cached[1] if cached else None
			self._cache[slug] = (mtime, cfg)
			return cfg


class Store:
	def __init__(self, db_path: str):
		self.conn = sqlite3.connect(db_path, check_same_thread=False)
		self.conn.execute("PRAGMA journal_mode=WAL")
		self.conn.execute("PRAGMA synchronous=NORMAL")
		self.conn.executescript(SCHEMA)
		self._lock = threading.Lock()

	def record(self, quiz: str, row: AnswerRow) -> bool:
		"""Insert one answer; returns False when already answered in that generation."""
		with self._lock, self.conn:
			cur = self.conn.execute(
				"INSERT OR IGNORE INTO answers VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				(
					quiz,
					row.generation,
					row.session_id,
					row.q_index,
					row.answer,
					row.name,
					row.client_ts,
					row.received_ts,
				),
			)
			return cur.rowcount > 0

	def rows(
		self, quiz: str, generation: int | None = None, session_id: str | None = None
	) -> list[AnswerRow]:
		query = (
			"SELECT generation, session_id, q_index, answer, name, client_ts, received_ts"
			" FROM answers WHERE quiz = ?"
		)
		params: list[str | int] = [quiz]
		if generation is not None:
			query += " AND generation = ?"
			params.append(generation)
		if session_id is not None:
			query += " AND session_id = ?"
			params.append(session_id)
		with self._lock:
			cur = self.conn.execute(query + " ORDER BY received_ts", params)
			return [AnswerRow(*r) for r in cur.fetchall()]


def score_of(rows: list[AnswerRow], correct: tuple[str | None, ...]) -> int:
	return sum(
		1
		for r in rows
		if 0 <= r.q_index < len(correct) and correct[r.q_index] is not None and r.answer == correct[r.q_index]
	)


def session_stats(rows: list[AnswerRow], correct: tuple[str | None, ...]) -> list[SessionStat]:
	by_session: dict[str, list[AnswerRow]] = {}
	for r in rows:
		by_session.setdefault(r.session_id, []).append(r)
	stats = []
	for sid, srows in by_session.items():
		last = max(srows, key=lambda r: r.received_ts)
		stats.append(
			SessionStat(
				session_id=sid,
				name=last.name,
				score=score_of(srows, correct),
				answered=len(srows),
				last_ts=last.received_ts,
			)
		)
	return stats


def leaderboard_entries(stats: list[SessionStat], cfg: LeaderboardConfig) -> list[dict[str, Any]]:
	# ties break toward whoever reached the score first
	ranked = sorted(stats, key=lambda s: (-s.score, s.last_ts))
	entries: list[dict[str, Any]] = []
	for s in ranked[: cfg.top_n]:
		entry: dict[str, Any] = {"name": s.name}
		if cfg.show_points:
			entry["points"] = s.score
		entries.append(entry)
	return entries


def public_config(cfg: QuizConfig) -> dict[str, Any]:
	return {
		"slug": cfg.slug,
		"name": cfg.name,
		"questions": list(cfg.questions),
		"labels": cfg.labels,
		"randomizeOrder": cfg.randomize_order,
		"nameMode": cfg.name_mode,
		"namePrefill": cfg.name_prefill,
		"namePrompt": cfg.name_prompt,
		"feedback": cfg.feedback,
		"leaderboard": {"visibility": cfg.leaderboard.visibility},
		"generation": cfg.generation,
	}


def handle_config(cfg: QuizConfig) -> dict[str, Any]:
	return public_config(cfg)


def handle_session(cfg: QuizConfig, store: Store, session_id: str) -> dict[str, Any]:
	rows = store.rows(cfg.slug, generation=cfg.generation, session_id=session_id)
	out: dict[str, Any] = {
		"answered": [{"qIndex": r.q_index, "answer": r.answer} for r in rows],
		"name": max(rows, key=lambda r: r.received_ts).name if rows else None,
	}
	if cfg.feedback in ("final", "both"):
		out["score"] = score_of(rows, cfg.correct)
	return out


def handle_answer(cfg: QuizConfig, store: Store, body: dict[str, Any]) -> dict[str, Any]:
	session_id = body.get("sessionId")
	if not isinstance(session_id, str) or not SESSION_RE.match(session_id):
		raise ApiError(400, "invalid sessionId")
	q_index = body.get("qIndex")
	if not isinstance(q_index, int) or not 0 <= q_index < len(cfg.questions):
		raise ApiError(400, "qIndex out of range")
	answer = body.get("answer")
	if answer not in DIRECTIONS or cfg.labels[answer.lower()] == "":
		raise ApiError(400, "answer is not an enabled direction")
	name = body.get("name")
	if not isinstance(name, str):
		name = ""
	name = name.strip()[:MAX_NAME_LEN]
	if cfg.name_mode == "required" and not name:
		raise ApiError(400, "name required")
	client_ts = body.get("timestamp")
	if not isinstance(client_ts, int):
		client_ts = 0
	# A client that was mid-quiz when the generation was bumped still gets its
	# answers saved, under the generation it was playing — invisible to the
	# current leaderboard, never lost.
	generation = body.get("generation")
	if not isinstance(generation, int):
		generation = cfg.generation
	generation = max(0, min(generation, cfg.generation))
	row = AnswerRow(generation, session_id, q_index, answer, name, client_ts, int(time.time() * 1000))
	inserted = store.record(cfg.slug, row)
	out: dict[str, Any] = {"ok": True, "duplicate": not inserted}
	if cfg.feedback in ("instant", "both") and cfg.correct[q_index] is not None:
		out["correct"] = answer == cfg.correct[q_index]
	return out


def handle_leaderboard(cfg: QuizConfig, store: Store) -> dict[str, Any]:
	if cfg.leaderboard.visibility == "none":
		return {"entries": []}
	stats = session_stats(store.rows(cfg.slug, generation=cfg.generation), cfg.correct)
	return {"entries": leaderboard_entries(stats, cfg.leaderboard)}


def handle_export(cfg: QuizConfig, store: Store, token: str | None) -> dict[str, Any]:
	if cfg.export_token is None:
		raise ApiError(404, "export not enabled")
	if not token or not hmac.compare_digest(token, cfg.export_token):
		raise ApiError(403, "bad token")
	rows = store.rows(cfg.slug)
	by_generation: dict[int, list[AnswerRow]] = {}
	for r in rows:
		by_generation.setdefault(r.generation, []).append(r)
	return {
		"answers": [
			{
				"generation": r.generation,
				"sessionId": r.session_id,
				"qIndex": r.q_index,
				"question": cfg.questions[r.q_index] if r.q_index < len(cfg.questions) else None,
				"answer": r.answer,
				"correct": r.answer == cfg.correct[r.q_index] if r.q_index < len(cfg.correct) and cfg.correct[r.q_index] else None,
				"name": r.name,
				"clientTs": r.client_ts,
				"receivedTs": r.received_ts,
			}
			for r in rows
		],
		"sessions": [
			{
				"generation": gen,
				"sessionId": s.session_id,
				"name": s.name,
				"score": s.score,
				"answered": s.answered,
				"lastTs": s.last_ts,
			}
			for gen in sorted(by_generation)
			for s in sorted(session_stats(by_generation[gen], cfg.correct), key=lambda s: (-s.score, s.last_ts))
		],
	}


class Handler(BaseHTTPRequestHandler):
	registry: QuizRegistry
	store: Store
	protocol_version = "HTTP/1.1"

	def _send(self, status: int, payload: dict[str, Any]) -> None:
		data = json.dumps(payload).encode()
		self.send_response(status)
		self.send_header("Content-Type", "application/json")
		self.send_header("Content-Length", str(len(data)))
		self.send_header("Cache-Control", "no-store")
		self.end_headers()
		self.wfile.write(data)

	def _dispatch(self, method: str) -> None:
		url = urlparse(self.path)
		if url.path == "/api/health":
			self._send(200, {"ok": True, "quizzes": self.registry.slugs})
			return
		m = ROUTE_RE.match(url.path)
		if not m:
			self._send(404, {"error": "not found"})
			return
		slug, action, session_id = m.group(1), m.group(2), m.group(3)
		cfg = self.registry.get(slug)
		if cfg is None:
			self._send(404, {"error": "no such quiz"})
			return
		try:
			if method == "GET" and action is None:
				self._send(200, handle_config(cfg))
			elif method == "GET" and session_id is not None:
				self._send(200, handle_session(cfg, self.store, session_id))
			elif method == "GET" and action == "leaderboard":
				self._send(200, handle_leaderboard(cfg, self.store))
			elif method == "GET" and action == "export":
				token = parse_qs(url.query).get("token", [None])[0]
				self._send(200, handle_export(cfg, self.store, token))
			elif method == "POST" and action == "answer":
				self._send(200, handle_answer(cfg, self.store, self._read_body()))
			else:
				self._send(405, {"error": "method not allowed"})
		except ApiError as e:
			self._send(e.status, {"error": e.message})

	def _read_body(self) -> dict[str, Any]:
		length = int(self.headers.get("Content-Length", 0))
		if not 0 < length <= MAX_BODY_BYTES:
			raise ApiError(400, "bad content length")
		try:
			body = json.loads(self.rfile.read(length))
		except json.JSONDecodeError:
			raise ApiError(400, "invalid json") from None
		if not isinstance(body, dict):
			raise ApiError(400, "body must be an object")
		return body

	def do_GET(self) -> None:
		self._dispatch("GET")

	def do_POST(self) -> None:
		self._dispatch("POST")


def main() -> None:
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("--quizzes", type=Path, required=True, help="directory of <slug>.json quiz configs")
	parser.add_argument("--db", required=True, help="sqlite database path")
	parser.add_argument("--port", type=int, default=5080)
	parser.add_argument("--host", default="127.0.0.1")
	args = parser.parse_args()

	Path(args.db).parent.mkdir(parents=True, exist_ok=True)
	Handler.registry = QuizRegistry(args.quizzes)
	Handler.store = Store(args.db)
	server = ThreadingHTTPServer((args.host, args.port), Handler)
	print(f"serving {Handler.registry.slugs} on {args.host}:{args.port}", flush=True)
	server.serve_forever()


if __name__ == "__main__":
	main()
