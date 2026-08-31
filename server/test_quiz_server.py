import unittest

from quiz_server import (
	AnswerRow,
	ApiError,
	LeaderboardConfig,
	Store,
	handle_answer,
	handle_export,
	handle_leaderboard,
	handle_session,
	leaderboard_entries,
	parse_quiz_config,
	public_config,
	session_stats,
)

RAW = {
	"name": "Test Quiz",
	"labels": {"left": "False", "right": "True", "up": "", "down": ""},
	"questions": [
		{"text": "Q1", "correct": "Right"},
		{"text": "Q2", "correct": "Left"},
		{"text": "Q3", "correct": "Right"},
	],
	"feedback": "none",
	"nameMode": "required",
	"leaderboard": {"topN": 3, "showPoints": False, "visibility": "done"},
	"exportToken": "secret-token",
}


def make_cfg(**overrides):
	raw = {**RAW, **overrides}
	return parse_quiz_config("test", raw)


def answer_body(session="session-aaa-1", q=0, direction="Right", name="Alice", ts=1000):
	return {"sessionId": session, "qIndex": q, "answer": direction, "name": name, "timestamp": ts}


class ParseTest(unittest.TestCase):
	def test_valid(self):
		cfg = make_cfg()
		self.assertEqual(cfg.questions, ("Q1", "Q2", "Q3"))
		self.assertEqual(cfg.correct, ("Right", "Left", "Right"))
		self.assertTrue(cfg.name_prefill)
		self.assertFalse(make_cfg(namePrefill=False).name_prefill)
		self.assertEqual(cfg.name_prompt, "What's your name?")
		self.assertEqual(make_cfg(namePrompt="Add meg a neved!").name_prompt, "Add meg a neved!")

	def test_rejects_empty_questions(self):
		with self.assertRaises(ValueError):
			make_cfg(questions=[])

	def test_rejects_bad_correct_direction(self):
		with self.assertRaises(ValueError):
			make_cfg(questions=[{"text": "Q", "correct": "Sideways"}])

	def test_rejects_correct_on_disabled_direction(self):
		with self.assertRaises(ValueError):
			make_cfg(questions=[{"text": "Q", "correct": "Up"}])

	def test_public_config_has_no_answer_key(self):
		pub = public_config(make_cfg())
		self.assertNotIn("correct", str(pub))
		self.assertNotIn("exportToken", str(pub))
		self.assertNotIn("secret-token", str(pub))


class AnswerTest(unittest.TestCase):
	def setUp(self):
		self.store = Store(":memory:")
		self.cfg = make_cfg()

	def test_record_and_duplicate(self):
		out = handle_answer(self.cfg, self.store, answer_body())
		self.assertEqual(out, {"ok": True, "duplicate": False})
		out = handle_answer(self.cfg, self.store, answer_body(direction="Left"))
		self.assertEqual(out, {"ok": True, "duplicate": True})

	def test_feedback_none_hides_correct(self):
		out = handle_answer(self.cfg, self.store, answer_body())
		self.assertNotIn("correct", out)

	def test_feedback_instant_reveals_correct(self):
		cfg = make_cfg(feedback="instant")
		out = handle_answer(cfg, self.store, answer_body(direction="Right"))
		self.assertTrue(out["correct"])
		out = handle_answer(cfg, self.store, answer_body(q=1, direction="Right"))
		self.assertFalse(out["correct"])

	def test_rejects_bad_input(self):
		for body in [
			answer_body(session="x"),
			answer_body(q=99),
			answer_body(direction="Up"),
			answer_body(name=""),
		]:
			with self.assertRaises(ApiError):
				handle_answer(self.cfg, self.store, body)

	def test_name_optional_when_disabled(self):
		cfg = make_cfg(nameMode="disabled")
		out = handle_answer(cfg, self.store, answer_body(name=""))
		self.assertTrue(out["ok"])


class SessionTest(unittest.TestCase):
	def setUp(self):
		self.store = Store(":memory:")

	def test_answered_set_and_score_gating(self):
		cfg = make_cfg()
		handle_answer(cfg, self.store, answer_body(q=0, direction="Right"))
		handle_answer(cfg, self.store, answer_body(q=1, direction="Right"))
		out = handle_session(cfg, self.store, "session-aaa-1")
		self.assertEqual(sorted(a["qIndex"] for a in out["answered"]), [0, 1])
		self.assertEqual(out["name"], "Alice")
		self.assertNotIn("score", out)
		out = handle_session(make_cfg(feedback="final"), self.store, "session-aaa-1")
		self.assertEqual(out["score"], 1)


class LeaderboardTest(unittest.TestCase):
	def rows(self):
		return [
			AnswerRow(0, "s1", 0, "Right", "Alice", 0, 10),
			AnswerRow(0, "s1", 1, "Left", "Alice", 0, 20),
			AnswerRow(0, "s2", 0, "Right", "Bob", 0, 5),
			AnswerRow(0, "s2", 1, "Right", "Bob", 0, 15),
			AnswerRow(0, "s3", 0, "Right", "Carol", 0, 8),
			AnswerRow(0, "s3", 1, "Left", "Carol", 0, 30),
			AnswerRow(0, "s4", 0, "Left", "Dave", 0, 1),
		]

	def test_order_and_tiebreak(self):
		stats = session_stats(self.rows(), ("Right", "Left"))
		entries = leaderboard_entries(stats, LeaderboardConfig(top_n=3, show_points=False))
		# Alice and Carol both score 2; Alice finished earlier (ts 20 < 30)
		self.assertEqual([e["name"] for e in entries], ["Alice", "Carol", "Bob"])
		self.assertNotIn("points", entries[0])

	def test_top_n_and_points(self):
		stats = session_stats(self.rows(), ("Right", "Left"))
		entries = leaderboard_entries(stats, LeaderboardConfig(top_n=1, show_points=True))
		self.assertEqual(entries, [{"name": "Alice", "points": 2}])

	def test_visibility_none_serves_nothing(self):
		store = Store(":memory:")
		cfg = make_cfg(leaderboard={"topN": 3, "showPoints": True, "visibility": "none"})
		handle_answer(cfg, store, answer_body())
		self.assertEqual(handle_leaderboard(cfg, store), {"entries": []})


class GenerationTest(unittest.TestCase):
	def setUp(self):
		self.store = Store(":memory:")

	def test_reset_hides_old_answers_but_keeps_them(self):
		old = make_cfg(generation=0)
		handle_answer(old, self.store, answer_body(q=0))
		handle_answer(old, self.store, answer_body(q=1))
		new = make_cfg(generation=1)
		self.assertEqual(handle_session(new, self.store, "session-aaa-1")["answered"], [])
		self.assertEqual(handle_leaderboard(new, self.store), {"entries": []})
		out = handle_export(new, self.store, "secret-token")
		self.assertEqual(len(out["answers"]), 2)
		self.assertEqual(out["sessions"][0]["generation"], 0)

	def test_same_question_recordable_again_after_reset(self):
		handle_answer(make_cfg(generation=0), self.store, answer_body(q=0))
		out = handle_answer(make_cfg(generation=1), self.store, answer_body(q=0))
		self.assertFalse(out["duplicate"])

	def test_stale_client_generation_is_kept_out_of_current(self):
		cfg = make_cfg(generation=2)
		body = {**answer_body(q=0), "generation": 0}
		self.assertTrue(handle_answer(cfg, self.store, body)["ok"])
		future = {**answer_body(session="session-bbb-2", q=0), "generation": 9}
		self.assertTrue(handle_answer(cfg, self.store, future)["ok"])
		current = self.store.rows("test", generation=2)
		self.assertEqual([r.session_id for r in current], ["session-bbb-2"])
		self.assertEqual(len(self.store.rows("test", generation=0)), 1)


class ExportTest(unittest.TestCase):
	def test_token_gate(self):
		store = Store(":memory:")
		cfg = make_cfg()
		handle_answer(cfg, store, answer_body())
		with self.assertRaises(ApiError):
			handle_export(cfg, store, None)
		with self.assertRaises(ApiError):
			handle_export(cfg, store, "wrong")
		out = handle_export(cfg, store, "secret-token")
		self.assertEqual(len(out["answers"]), 1)
		self.assertTrue(out["answers"][0]["correct"])
		self.assertEqual(out["sessions"][0]["score"], 1)


if __name__ == "__main__":
	unittest.main()
