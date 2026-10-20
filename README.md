# Voxly — AI Voice Sales Bot

A working AI voice sales agent for SaaS products: it holds a real voice conversation (English or Hindi), answers product questions from a grounded knowledge base, records the call with explicit consent, generates a transcript-grounded AI summary, classifies the sales outcome, and persists everything in SQLite for call history.

Built for the **Sankar Group internship assignment**. Node.js backend + vanilla frontend — **zero runtime npm dependencies** (the database is Node's built-in `node:sqlite`, so there is no native build step and nothing to install).

---

## 1. What was in this repository before

The initial commit contained only `README.md`, `package.json`, `.env`, `.env.example`, `.gitignore` and a placeholder `package-lock.json`. The `voice-sales-bot/` directory that the README described **did not exist** — there was no server, no UI, and `npm start` failed. Nothing was deleted or renamed; the existing dark visual language (`#0b1020`, `#11182a`, `#9cf4c7`), product concept, npm script names and documented structure were preserved and implemented.

---

## 2. Architecture

```
Browser (voice-sales-bot/public: index.html, styles.css, app.js)
  ├─ SpeechRecognition API  → customer speech to text
  ├─ speechSynthesis API    → speaks AI replies (echo-guarded)
  ├─ MediaRecorder API      → records microphone audio (consent required)
  └─ fetch('/api/*')        ← same origin only; no API keys in the browser
             │
Node HTTP server (voice-sales-bot/server.js)
  ├─ lib/ai.js        → real Gemini / OpenAI HTTP calls + prompt grounding
  ├─ lib/products.js  → verified product knowledge base (single source of truth)
  ├─ lib/db.js        → SQLite (node:sqlite) + recording files on disk
  ├─ lib/validation.js→ input validation, status normalisation
  └─ lib/config.js    → .env loading, provider detection, limits
             │
gemini-2.5-flash / gpt-4o-mini  ·  voice-sales-bot/data/sales_bot.db + data/recordings/
```

**No simulated AI responses exist anywhere in the code.** If no key is configured, or the provider returns 401/429/5xx/timeout, the exact error code and message are shown in the UI and recorded in the call row.

---

## 3. Features

### Real AI conversation
- Server-side calls to **Google Gemini** (`GEMINI_MODEL`, default `gemini-2.5-flash`) or **OpenAI**, with automatic model fallback when a model name is unavailable.
- Answers are grounded in a verified knowledge base for **FlowPilot**, **CloudDesk**, **TeamSync** and **InsightIQ** (pricing, features, differentiators, approved objection handling, trial/contract policies). The system prompt forbids inventing prices, features or commitments; unknown questions must be deferred to a follow-up.
- **English and Hindi** (Devanagari) conversations; the model mirrors whichever language the customer uses.
- Turkish-style surprises handled: safety blocks, empty responses, invalid JSON and upstream failures all produce explicit, actionable errors.

### Voice
- Microphone capture via `getUserMedia`, transcription via the browser `SpeechRecognition` API with interim results.
- AI replies spoken with `speechSynthesis`, matching `en-IN` / `hi-IN` voices.
- **Echo prevention**: recognition is aborted while the agent speaks and restarted when speech ends.
- Graceful degradation: permission denied, no microphone, unsupported browser or speech-synthesis failure each produce a specific message and a working text-chat fallback.

### Call controls
- Start / End call buttons, mute mic, live `MM:SS` timer, connection status (`Not connected → Connecting → Connected → Disconnected`) and an outcome badge.
- **Duplicate sessions blocked server-side** (HTTP 409 with the active call details), plus a resume banner for calls left open by a reload. Abandoned calls auto-close after `ACTIVE_CALL_TTL_MINUTES` (default 30).

### Recording
- Consent checkbox is required before any audio is captured; the server independently rejects uploads for calls without consent (409).
- `MediaRecorder` → Opus/WebM (Safari: MP4), uploaded after the call, stored on disk as `<call-uuid>.<ext>`.
- Inline playback in the outcome panel and in every history record, streamed with HTTP **Range / 206** support so scrubbing works.
- Unsupported `MediaRecorder` is detected up front; the call continues and the transcript is still saved. Failed uploads offer a retry button.

### AI summary (grounded in the stored transcript)
After the call the server sends the real transcript to the model and validates the JSON response:
**overview · customer requirements · questions asked · objections · customer interest (High/Medium/Low/None + reason) · next steps · status**.
Validation strips malformed fields, rejects invalid statuses, and **downgrades a hallucinated `Converted`** unless the customer's own words contain a purchase signal. A call with no customer speech is classified `No Response` without spending an AI call.

### Sales classification
Exactly one of `Converted`, `Interested`, `Follow-up Required`, `Not Interested`, `Demo Requested`, `No Response`.
Source is tracked and displayed: `ai` (model) vs `rules` (deterministic keyword fallback in English + Hindi when the AI is unavailable). Nothing is presented as AI output when it is not.

### Call history and persistence
- SQLite file `voice-sales-bot/data/sales_bot.db` (WAL mode, foreign keys). Survives restarts.
- History shows date, duration, product, language, status, transcript, recording player, summary; filter by status, search transcript text, delete, and export all calls as JSON.
- Insights tab: totals, conversion rate, average duration, recordings stored, status distribution.

### UI
Premium dark dashboard preserved, responsive at 1080/760 px breakpoints, skeleton loading states, empty states, inline errors with retry, ARIA live regions, tab/radiogroup semantics, keyboard-navigable tabs, focus-visible outlines and `prefers-reduced-motion` support.

### Security
- API keys live only in server environment variables; `/api/config` and `/api/health` expose provider/model names but never the key. A test asserts the key never appears in any response.
- Server-side validation of every body and id: UUID format, language/status whitelists, message length, JSON size limit, audio MIME whitelist, recording size cap.
- Recording files are named from server-generated UUIDs; paths are resolved and checked against the public/recordings roots (traversal blocked). Content-Disposition is set explicitly.
- CSP (`script-src 'self'`), `X-Content-Type-Options`, `Referrer-Policy`, `X-Robots-Tag: noindex`, no `X-Powered-By`. Security headers are applied to media responses too.
- Structured error JSON without stack traces; server logs contain error codes/messages only — never prompts, keys or transcripts.
- Optional `ADMIN_TOKEN` protects delete and export (`x-admin-token`). Per-IP rate limiting on AI endpoints.

---

## 4. Run locally

**Requirements:** Node.js **22.13+** (uses built-in `node:sqlite`) — verified on Node **v22.22.3**. Chrome or Edge for speech recognition; Safari/Firefox work in text mode (and record audio where supported).

```bash
git clone <your-repo> voice-assistent
cd voice-assistent
npm install                 # no dependencies; regenerates the lockfile
cp .env.example .env        # then edit .env
```

Set at minimum:

```env
PORT=3000
GEMINI_API_KEY=AIza...your_key      # https://aistudio.google.com/apikey
GEMINI_MODEL=gemini-2.5-flash
```

Start it:

```bash
npm start          # http://localhost:3000
npm run dev        # auto-reload
```

Verify the AI path end-to-end (needs outbound internet access):

```bash
npm run verify:ai
# Provider : gemini
# Model    : gemini-2.5-flash
# [1/2] Sales reply OK ...
# [2/2] Summary OK ...
```

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | HTTP listener |
| `GEMINI_API_KEY` | – | Gemini key (required for live AI) |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Primary model |
| `GEMINI_FALLBACK_MODELS` | `gemini-2.5-flash,gemini-2.0-flash` | Tried when the primary model 404s |
| `GEMINI_AUTH_MODE` | `auto` | `auto` tries `?key=` then `Authorization: Bearer` on 401/403; pin with `key` or `bearer` |
| `GEMINI_API_BASE_URL` / `GEMINI_API_VERSION` | Google public API | For proxies / Vertex-compatible gateways |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | – / `gpt-4o-mini` | Alternative provider |
| `AI_PROVIDER` | `auto` | `auto` \| `gemini` \| `openai` |
| `AI_TIMEOUT_MS` | `30000` | Upstream timeout |
| `DATA_DIR` | `voice-sales-bot/data` | SQLite + recordings (point at a volume in production) |
| `ADMIN_TOKEN` | – | Protects delete + export when set |
| `MESSAGE_MAX_LENGTH` | `2000` | Per-turn input cap |
| `JSON_BODY_MAX_BYTES` | `131072` | JSON body cap |
| `RECORDING_MAX_BYTES` | `26214400` | Audio upload cap (25 MB) |
| `AI_REQUESTS_PER_MINUTE` | `40` | Per-IP rate limit |
| `ACTIVE_CALL_TTL_MINUTES` | `30` | Abandoned-call auto-close |
| `MAX_TURNS_PER_CALL` | `60` | Turn cap per call |
| `HISTORY_LIMIT` | `200` | Max rows returned |

---

## 5. Testing

```bash
npm test        # 42 automated tests (node:test)
npm run check   # syntax check of server + browser bundle
```

| File | Covers |
| --- | --- |
| `tests/db.test.js` | Schema creation, CRUD, message counters, duration, recording metadata, stats, delete cascade, persistence across reopen |
| `tests/validation.test.js` | Status normalisation, all six classifications (EN + HI), summary sanitisation, `Converted` guard, input validators, provider/auth config, product KB integrity |
| `tests/ai.test.js` | Real Gemini request shape (`systemInstruction`, contents, JSON mode), bearer vs query auth, model fallback, 401/429/network/empty-response errors, summary grounding, markdown-fenced JSON, zero-turn short-circuit, Hindi prompt |
| `tests/api.test.js` | Full lifecycle over HTTP: start, 409 duplicate session, reply, recording upload + 206 ranges + 416, end + AI summary, idempotent end, history filters/search, regenerate summary, export, delete + file removal, no-key 503, validation, stale-call recovery, static serving + traversal, security headers |
| `tests/security.test.js` | Header suite, UUID-only storage, path traversal, PUT 405, oversized bodies, rate limiting, error shape without secrets/stacks, admin-token protection |

The AI provider is replaced by a protocol-faithful mock (`tests/helpers.js`) so the suite runs offline and deterministically. **No real provider call is possible inside the build sandbox (outbound access to `generativelanguage.googleapis.com` is blocked)** — run `npm run verify:ai` on your machine or deployment to confirm the live path with your key.

**Executed in this session:**
- `npm test` → **42/42 passing**, exit 0.
- A jsdom harness driving the real `public/app.js` against a mocked backend → **22/22 UI assertions passing** (provider pill, 4 products, start/end guards, greeting, customer turn, reply, typing indicator, summary fields, status badge, recording player, connection state, history list + stats, insights chart). The harness is throwaway tooling and is not part of the repo.
- **Real-network end-to-end run** (temporary harness in `/tmp`, not shipped): a second Voxly instance pointed at a local Gemini-protocol server via `GEMINI_API_BASE_URL` → **18/18 checks**: health, AI greeting, 409 duplicate session, grounded reply, audio upload, 206 range playback (exact `Content-Range` + 1024-byte slice), end + `Demo Requested` classification, summary fields, history row, 3-message transcript.
- **Restart persistence**: stopped and restarted that instance → call, status, duration (73 s), transcript (3 messages), summary and the 6000-byte recording were all still served from SQLite + disk.
- Live server smoke test against the real provider (`npm start`) → `/api/health` 200, `/api/config` 200, call creation returns a structured `AI_NETWORK_ERROR` because the sandbox has no provider access; static assets + CSP headers correct.

---

## 6. Deploy

### Render (recommended, included blueprint)
1. Push the repo to GitHub.
2. Render → **New → Blueprint**, select the repo (`render.yaml`), or create a Web Service manually:
   - Build: `npm install --omit=dev`
   - Start: `npm start`
   - Health check: `/api/health`
3. Env: `GEMINI_API_KEY` (secret), `GEMINI_MODEL=gemini-2.5-flash`, `DATA_DIR=/var/data`.
4. Attach a **persistent disk** at `/var/data` (1 GB is plenty) — otherwise SQLite and recordings vanish on redeploy.
5. Set `NODE_VERSION=24` if Render does not pick it up automatically.

### Live demo (deployed)

| Environment | URL | Storage |
| --- | --- | --- |
| **Vercel production** | **https://voice-assistent-pi.vercel.app** | ephemeral (`/tmp`), history resets |
| Render / Docker with a volume | your own domain | persistent |

The Vercel project (`voice-assistent`) deploys `main` on every push. Check it with
`GET https://voice-assistent-pi.vercel.app/api/health` — expect `"configured": true`,
`provider: "gemini"` and `storage.persistent: false`.

### Vercel (demo deployment)
`vercel.json` + `api/index.mjs` are included. The Node HTTP handler is mounted as one serverless function:
`/api/*` is rewritten to it, and `voice-sales-bot/public` is served statically.

1. Vercel → **Add New → Project → Import Git Repository** → `amansatyam408-prog/voice-assistent`.
2. Set **Production Branch** to the branch you want to deploy (e.g. `arena/f78866ee-voice-assistent`).
3. Framework preset: **Other**. Leave build/output settings to `vercel.json` (`outputDirectory: voice-sales-bot/public`).
4. Environment variables: `GEMINI_API_KEY` (secret), `GEMINI_MODEL=gemini-2.5-flash`, `GEMINI_FALLBACK_MODELS=gemini-2.0-flash`, `DATA_DIR=/tmp/voxly-data`.
5. Deploy, then open `https://<project>.vercel.app/api/health` — `storage.persistent` will be `false`.

**Important — Vercel has no persistent disk.** The SQLite database and recordings live in `/tmp`, which is
per-instance and wiped on cold starts, so **call history/recordings do not survive** there. The app detects this
serverless/ephemeral mode and shows a dismissible "temporary storage" banner plus `storage.persistent: false`
in `/api/health`, instead of silently losing data. For a permanent history use Render/Docker/Fly with a volume
(the same code, same UI).

### Railway / Fly.io
Deploy from the repo with the Dockerfile or Nixpacks, then **attach a volume** and set `DATA_DIR` to its mount path (e.g. `/data`). Railway's default filesystem is ephemeral.

### Docker
```bash
docker build -t voxly .
docker run -d --name voxly -p 3000:3000 \
  -e GEMINI_API_KEY=AIza... \
  -e GEMINI_MODEL=gemini-2.5-flash \
  -v voxly-data:/data \
  voxly
```
The image runs as the non-root `node` user, stores state in `/data`, and has a `/api/health` healthcheck.

### Any VPS
```bash
npm ci --omit=dev
GEMINI_API_KEY=... DATA_DIR=/var/lib/voxly NODE_ENV=production npm start
```
Put it behind nginx/Caddy with HTTPS. **Microphone and speech APIs require a secure context**: `localhost` works during development, but any remote host must be served over HTTPS.

### Production checklist
- [ ] Rotate any key that was ever committed to git (this repo's history contained a real key — see Limitations).
- [ ] `DATA_DIR` on a persistent volume, backed up (`.db` + `recordings/`).
- [ ] `ADMIN_TOKEN` set, HTTPS enforced.
- [ ] Consent text reviewed for your jurisdiction (India DPDP Act / GDPR).
- [ ] Retain `GEMINI_MODEL` + fallbacks valid for your API tier.

---

## 7. API reference

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness + AI config status (no secrets) |
| `GET` | `/api/config` | Products, languages, statuses, limits, active call |
| `POST` | `/api/calls` | `{productId, language, consentRecording}` → 201, greeting + first message; 409 if a call is active; 503 if no AI key |
| `GET` | `/api/calls` | `?status=&search=&limit=` → calls + stats |
| `GET` | `/api/calls/active` | Current unfinished call or `null` |
| `GET` | `/api/calls/:id` | Call with transcript, summary, recording metadata |
| `POST` | `/api/calls/:id/greeting` | Regenerate the opening line if the first attempt failed |
| `POST` | `/api/calls/:id/reply` | `{message}` → customer + assistant messages |
| `POST` | `/api/calls/:id/retry` | Re-answer the last customer message after an AI error |
| `POST` | `/api/calls/:id/end` | `{durationSeconds}` → ends, summarizes, classifies |
| `POST` | `/api/calls/:id/summary` | Regenerate summary for an ended call |
| `POST` | `/api/calls/:id/recording` | Raw audio body (`audio/*` or `video/webm`), consent required |
| `GET`/`HEAD` | `/api/calls/:id/recording` | Audio stream with Range support |
| `DELETE` | `/api/calls/:id` | Removes DB rows + audio file (admin token if configured) |
| `GET` | `/api/export` | Full JSON export (admin token if configured) |
| `GET` | `/api/stats` | Aggregates |

Errors are always `{ "error": { "code", "message", "details?", "providerStatus?" } }`.

---

## 8. Demo script (2 minutes)

1. Open the app, pick **FlowPilot**, language **English**, tick consent.
2. **Start call** → allow the microphone. Voxly greets you (real model output).
3. Say: *“Approvals take three days for my 15-person team. How much does FlowPilot cost?”*
   → grounded pricing answer + a qualifying question.
4. Raise an objection: *“That feels expensive.”* → approved objection response.
5. Say: *“Can you send me a quote and arrange a demo?”*
6. **End call** → timer stops, recording uploads, summary + status appear (`Demo Requested` / `Follow-up Required`).
7. Switch to **Call history** → open the record, play the audio, read the transcript and summary. Reload the page — it is still there (SQLite).
8. Hindi run: choose **हिंदी** and say *“कीमत क्या है? मुझे डेमो चाहिए।”*

---

## 9. Known limitations

1. **Live AI was not verifiable inside the build sandbox** — outbound access to `generativelanguage.googleapis.com` is blocked, so real-model behaviour was validated against a protocol-faithful mock (request shape, auth, parsing, error mapping) rather than the live service. Run `npm run verify:ai` in your environment; it performs two real calls and prints pass/fail.
2. **Speech input is browser-based.** Chrome/Edge provide `SpeechRecognition` (which uses Google's speech service); Firefox lacks it and Safari has partial support — those browsers fall back to typing. The recording still works where `MediaRecorder` exists.
3. **The recording contains your microphone audio only.** `speechSynthesis` output cannot be routed into `MediaRecorder`, so Voxly's synthesized voice is not in the file; the full conversation is preserved in the transcript. Server-side TTS would be required for a mixed recording.
4. **Single-tenant demo.** Anyone with the URL can read call history (IDs are unguessable UUIDs, but there is no user auth). Set `ADMIN_TOKEN` to protect delete/export, and add real auth before production use.
5. **Rate limiting is per-process and in-memory**, so it resets on restart and does not coordinate across instances.
6. **SQLite** suits a single instance. Multi-instance deployments need Postgres and object storage (S3/R2) for recordings.
7. **`node:sqlite` requires Node 22.13+** (still marked experimental upstream, hence the startup flag that silences the warning).
8. **Translation quality** depends on the model; Hindi replies are not professionally reviewed.
9. **The repo's git history contains a real Gemini key** (`.env` was committed). `.env` is now untracked and ignored — **rotate that key** in AI Studio.
