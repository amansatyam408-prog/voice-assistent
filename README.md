# Voxly — AI Voice Sales Bot (Sankar Group Assignment)

> An enterprise-grade, real-time AI Voice Sales Agent that sells SaaS products through interactive voice conversations, captures customer audio recordings with explicit consent, analyzes sales intelligence, and persists calls to a persistent SQLite database.

---

## 🌟 Key Features

### 1. Real AI Voice Sales Conversation
- **Live AI Model Integration**: Powered by Google Gemini (`gemini-2.0-flash` with fallback to `gemini-1.5-flash`) or OpenAI (`gpt-4o-mini`).
- **SaaS Product Knowledge**: Built-in verified knowledge bases for **FlowPilot** (workflow automation), **CloudDesk** (customer support helpdesk), **TeamSync** (agile project management), and user-defined **Custom SaaS**.
- **Multi-Language Support**: Full conversational voice support in **English** and **Hindi** (हिंदी), with extensible support for **Telugu**.
- **Transparent Simulation Fallback**: If an API key is not configured, the app runs in an honest, clearly badged offline demo mode so testers can evaluate the UX without unexpected errors.
- **Explicit Error Reporting**: Backend validates API keys and returns structured error messages rather than silently masking issues.

### 2. Voice & Browser Speech Coordination
- **Speech-to-Text (STT)**: Real-time microphone transcription using the browser `SpeechRecognition` API.
- **Text-to-Speech (TTS)**: Spoken voice responses using `window.speechSynthesis` with language-specific voice selection (Hindi/English).
- **Echo Prevention**: Automatically pauses speech recognition while the AI agent speaks, resuming smoothly once speech ends.
- **Graceful Fallbacks**: If speech recognition is unsupported or microphone access is denied, seamless text chat fallback is immediately activated.
- **Mute / Unmute**: One-click voice mute control.

### 3. Call Controls & Duplicate Session Prevention
- **Start / End Call Buttons**: Dedicated, accessible call action buttons with keyboard and screen reader support.
- **Live Duration Timer**: Real-time timer (`MM:SS`) tracking conversation duration.
- **Session Protection**: Server-backed active session management prevents concurrent or duplicate call sessions.

### 4. Audio Recording & Playback with Explicit Consent
- **Explicit Consent**: Requires checking the recording consent box before audio is captured. If unconsented, calls proceed without recording.
- **Real Audio Capture**: Uses `MediaRecorder` with Opus compression (`audio/webm`) to record customer conversation audio.
- **Dual Playback**:
  1. Inline audio player rendered right in the live call window upon completion.
  2. Persistent audio players for every saved call in **Call History** and the **Summary Modal**.
- **Streaming Audio Endpoint**: Backend streams audio with HTTP 206 Partial Content (Range headers) for smooth scrubbing and seeking.

### 5. Automated AI Sales Summary
Post-call intelligence extraction analyzes the actual transcript and generates:
1. **Executive Summary**: 2-3 sentence overview of the conversation.
2. **Customer Requirements**: Stated business needs and use cases.
3. **Questions Asked**: Exact customer inquiries.
4. **Objections Raised**: Pricing, security, or migration concerns.
5. **Customer Interest Assessment**: Evaluation of buyer engagement.
6. **Actionable Next Steps**: Tailored sales recommendations.

### 6. Sales Classification (6 Standard Statuses)
Automatically assigns one of 6 official sales statuses based strictly on conversation signals:
- `Converted` — Explicit purchase confirmation or subscription agreement.
- `Interested` — Positive engagement and interest in features/benefits.
- `Demo Requested` — Request for a live product demonstration or walkthrough.
- `Follow-up Required` — Request for email collateral, quote, or callback.
- `Not Interested` — Explicit refusal or opt-out.
- `No Response` — Disconnection without customer input.

### 7. Persistent Database & Call History
- **SQLite Database**: Uses Node.js 24's native `node:sqlite` (`sales_bot.db`) with WAL mode for fast, ACID-compliant persistence.
- **Zero LocalStorage Quota Errors**: Audio files are safely stored on disk in `data/recordings/` rather than bloating browser memory.
- **Search & Filter**: Filter calls by status (`Converted`, `Interested`, `Demo Requested`, etc.) or search transcripts by keyword.
- **Export**: One-click download of all call records as formatted JSON.

### 8. Premium Dark Dashboard UI
- Sleek, modern dark aesthetic (`#0b1020`, `#11182a`, `#9cf4c7`).
- Fully responsive across Desktop, Tablet, and Mobile devices.
- Animated AI orb visualizer and real-time typing indicators.
- In-app Settings modal for entering API keys at runtime without modifying files.

### 9. Security & Privacy
- **API Key Protection**: Keys are stored exclusively on the backend (`process.env`) and never exposed to client bundles.
- **Path Traversal Protection**: Audio recording endpoints sanitize IDs against directory traversal attacks (`/api/calls/:id/recording`).
- **Security Headers**: Enforces `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and strict referrer policies.
- **Payload Limits**: Strict length checks on messages and JSON bodies.

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js**: v18.0.0 or newer (Node.js v20+ or v24+ recommended for native SQLite).
- **Browser**: Google Chrome or Microsoft Edge recommended for native Web Speech API recognition.

### 1. Installation
Clone or navigate to the project directory:
```bash
cd voice-sales-bot
npm install
```

### 2. Configure Environment Variables
Copy the example environment file:
```bash
cp .env.example .env
```
Open `.env` and add your **Google Gemini API Key**:
```env
PORT=3000
GEMINI_API_KEY=AIzaSy...your_gemini_api_key_here
GEMINI_MODEL=gemini-2.0-flash
ALLOW_OFFLINE_DEMO=true
```
> **Tip**: You can get a free Gemini API key from [Google AI Studio](https://aistudio.google.com/).
> If no API key is provided, the application runs in **Offline Demo Mode** with realistic simulations and clear badges.

### 3. Run the Application
Start the server:
```bash
npm start
```
For development with auto-reload:
```bash
npm run dev
```

Open your browser at:
```
http://localhost:3000
```

---

## 🧪 Running Automated Tests

The project includes an end-to-end automated test suite covering database operations, AI response generation, status classification, audio recording streams, security headers, and input validation:

```bash
npm test
```

### Test Coverage Summary:
- `tests/database.test.js`: SQLite initialization, CRUD, audio recording file storage, duplicate session prevention, sales stats calculation.
- `tests/classification.test.js`: Status mapping across all 6 statuses (`Converted`, `Interested`, `Demo Requested`, `Follow-up Required`, `Not Interested`, `No Response`).
- `tests/ai.test.js`: SaaS product knowledge catalog, Hindi/English replies, 5-field summary extraction, zero-turn fallback.
- `tests/api.test.js`: HTTP endpoints (`/api/health`, `/api/config`, `/api/reply`, `/api/summary`, `/api/calls`, `/api/calls/:id/recording` with HTTP 206 Range headers).
- `tests/security.test.js`: Security headers, path traversal prevention, message length enforcement, API key leakage prevention.

---

## 🌐 Deployment Instructions

### Deploy to Render
1. Push your repository to GitHub.
2. Create a new **Web Service** on [Render](https://render.com/).
3. Set:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Add Environment Variables:
   - `GEMINI_API_KEY`: Your Google Gemini API key.
   - `PORT`: `10000` (Render default).
5. For persistent audio recordings across redeployments, attach a Render Persistent Disk mounted at `/data`.

### Deploy to Railway
1. Click **New Project** -> **Deploy from GitHub repo**.
2. Railway detects Node automatically.
3. In **Variables**, add `GEMINI_API_KEY`.
4. Deploy!

### Deploy via Docker
```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "voice-sales-bot/server.js"]
```

---

## 📋 Suggested Live Demo Flow

1. Open `http://localhost:3000` in Google Chrome or Edge.
2. Select your product (e.g., **FlowPilot**) and language (**English** or **Hindi**).
3. Check **"I have consent to record this conversation"**.
4. Click **Start call** and allow microphone access when prompted.
5. Listen to the opening greeting from Voxly AI.
6. Speak a customer question:
   - *"How much does FlowPilot cost for a team of 15?"*
   - Or in Hindi: *"क्या मुझे इसका लाइव डेमो मिल सकता है?"*
7. Observe the real-time transcript, live duration timer, and qualification outcome badge.
8. Click **End call**.
9. Notice the **inline audio player** appears immediately with your recorded conversation.
10. Click **Generate call summary** to view verified customer requirements, questions asked, objections, and the automatic sales classification.
11. Navigate to **Call history** to review all stored calls, filter by status, play recordings, or export data.
12. Navigate to **Sales insights** to view conversion metrics and outcome distributions.

---

## 🔒 Security & Privacy Notice
- Audio recordings and transcripts are stored locally in the persistent server SQLite database (`data/sales_bot.db` and `data/recordings/`).
- Never deploy without explicit user consent for voice recording in production environments.
