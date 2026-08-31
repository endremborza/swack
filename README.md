# Swack

Swipe surveys — think Tinder for questions. Respondents swipe in up to four directions to answer each card. Two modes share the same swipe UI:

- **Nostr mode (zero-cost)** — fully serverless. Form config and answers travel through public Nostr relays, end-to-end encrypted; keys live in the creator's browser. No server, no database, no account.
- **Quiz mode (self-hosted backend)** — a small Python + sqlite server holds the quiz (questions, answer key, leaderboard settings) and records every answer with a definitive ACK. Built for quizzes that must reliably work: resumable sessions, per-device dedup, configurable feedback and a leaderboard.

## Nostr mode

- `/create` — form builder; publishing is immutable and waits for relay confirmations before issuing a share link
- `/admin#<pubkey>` — read-only monitor: live answers, aggregates, CSV export, relay management, credential export/import
- `/fill#<pubkey>_<aeskey>` — the swipe interface; answers are NIP-44 encrypted to the form's pubkey and broadcast to the relay pool

## Quiz mode

The backend is `server/quiz_server.py` (Python stdlib only: `http.server` + `sqlite3`). Quizzes are JSON files in a directory (see `server/quizzes/example.json`); the slug is the filename stem and the answer key never leaves the server.

```sh
python3 server/quiz_server.py --quizzes server/quizzes --db data/swack.db --port 5080
```

API (all JSON, same-origin `/api` in production):

| Endpoint | Purpose |
|---|---|
| `GET /api/quiz/<slug>` | public config — questions, labels, modes; no answer key |
| `POST /api/quiz/<slug>/answer` | record one swipe; ACK = committed to sqlite, duplicates ignored |
| `GET /api/quiz/<slug>/session/<sid>` | answered set for resume (+ score when feedback allows) |
| `GET /api/quiz/<slug>/leaderboard` | top-N names (+ points when configured) |
| `GET /api/quiz/<slug>/export?token=…` | full dump, token-gated |
| `GET /api/health` | liveness + loaded quiz slugs |

Per-quiz config: `feedback` (`none`/`instant`/`final`/`both`), `leaderboard` (`topN`, `showPoints`, `visibility`), `nameMode`, `namePrefill` (suggest a stored/random name on the naming screen, or require typing one), `namePrompt` (the naming screen's question), `randomizeOrder`, `generation`. Scores are computed at read time from the config, so fixing an answer key rescores past answers.

Bumping `generation` resets a quiz without losing anything: answers are stored under the generation they were played in, the leaderboard and resume queries see only the current one, and clients discard local progress when the number changes (a client mid-quiz through a reset still gets its answers saved, under its old generation). Config files are reloaded on change, so a reset is just an edit + copy — no restart.

The frontend reaches quiz mode at `/quiz#<slug>`, or as a dedicated deployment: building with `VITE_QUIZ_SLUG=<slug>` makes the site root serve that quiz directly. Sessions persist in localStorage (resume, no repeated questions on a device); unACKed answers are retried from an outbox on return.

## Development

```sh
npm install
npm run dev          # vite dev server; /api proxies to localhost:5080
npm run test:unit    # vitest (frontend logic)
python3 -m unittest discover -s server   # backend tests
npm run test:e2e     # playwright
```

## Building

```sh
npm run build                            # gh-pages build (base /swack)
SWACK_BASE="" VITE_QUIZ_SLUG=he npm run build   # dedicated root-served quiz build
```

Output goes to `build/`; it is a static site, deploy anywhere (for GitHub Pages the fallback is `404.html`). `scripts/deploy-he.sh` builds and ships the he.borza.cc deployment (static build + backend) in one step.
