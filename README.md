<p align="center">
  <img src="extension/pictures/rethinkLogo.png" alt="Rethink AI Logo" width="220" />
</p>

<h1 align="center">Rethink AI</h1>
<p align="center">A real-time AI learning companion for Google Docs that guides students through their mistakes — without giving away the answer.</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white" />
  <img src="https://img.shields.io/badge/Node.js-Express-339933?logo=nodedotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/OCI-Llama%203.3%2070B-F80000?logo=oracle&logoColor=white" />
  <img src="https://img.shields.io/badge/Tailwind%20CSS-v3-06B6D4?logo=tailwindcss&logoColor=white" />
</p>

---

## What Is Rethink AI?

Rethink AI is a Chrome extension that silently monitors what a student writes in Google Docs. When it detects an error — a grammar mistake, a flawed math equation, a factual inaccuracy — it nudges the student with a subtle location hint and opens a Socratic chat where an AI tutor guides them to discover the fix themselves.

The core principle: **never give the answer, always guide the thinking.**

---
## INSTALLATION PROCESS FOR JUDGES
Go to Release to start using Rethink AI :)

## Features

- **Passive monitoring** — watches for completed sentences or lines without interrupting the writing flow
- **Error detection** — sends document text to an LLM that identifies mistakes in writing, math, and science
- **Location hints only** — the extension only tells the student *where* to look, never *what* is wrong
- **Socratic chat** — a built-in chat panel in the popup lets students ask questions; the AI responds with probing questions, not direct corrections
- **Subject-aware** — the student selects Writing, Math, Science, or Other; prompts are tuned accordingly
- **On/Off toggle** — students can disable the companion at any time
- **Works on all Google Docs** — using the `/export?format=txt` endpoint to read canvas-rendered text

---

## How It Works

```
Student types in Google Docs
        │
        ▼ (debounce 1.8 s)
Content Script extracts document text
        │
        ▼ chrome.runtime.sendMessage
background.js (service worker)
        │
        ▼ POST /analyze
Backend (Node.js / Express)
        │  LLM analyzes text → stores error internally
        │  Returns only: { hasError, location }
        ▼
Extension tooltip: "⚠ Potential issue — look at: <location>"
        │
        ▼ Student opens popup and asks a question
popup.js → background.js → POST /chat
        │  Backend injects hidden error into system prompt
        │  LLM replies with Socratic questions, never the answer
        ▼
Chat reply shown in popup
```

### The "Private Error" Pattern

The backend detects the actual mistake and keeps it completely hidden from the extension. Only a vague location hint travels to the client. When the student opens the chat, the backend secretly injects the real error into the LLM's system prompt so it can guide the student without the extension (or the student) ever seeing the raw error description.

---

## Architecture

```
┌────────────────────────────────────────┐
│  Chrome Extension (Manifest V3)        │
│                                        │
│  Content Scripts (7 files, ordered)    │
│  ├─ config.js       constants          │
│  ├─ state.js        shared state       │
│  ├─ ui.js           overlay + tooltip  │
│  ├─ text-extraction.js  /export fetch  │
│  ├─ api.js          storage + API      │
│  ├─ analyzer.js     debounce + loop    │
│  └─ init.js         listeners + MO     │
│                                        │
│  background.js  (service worker)       │
│  └─ Proxies HTTP calls                 │
│                                        │
│  popup/  (Tailwind CSS)                │
│  ├─ Toggle On/Off                      │
│  ├─ Subject selector                   │
│  ├─ Status banner                      │
│  └─ Socratic chat panel                │
└───────────────┬────────────────────────┘
                │ chrome.runtime.sendMessage
                ▼
┌───────────────────────────────────────┐
│  Backend  (Node.js / Express)         │
│  http://<backend-url>:3000            │
│                                       │
│  GET  /health                         │
│  POST /analyze  →  stores error       │
│  POST /chat     →  injects error      │
└───────────────┬───────────────────────┘
                │ OCI SDK (instance principal)
                ▼
┌───────────────────────────────────────┐
│  OCI Generative AI                    │
│  Llama 3.3 70B Instruct               │
│  us-chicago-1                         │
└───────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Extension | Chrome MV3, Vanilla JS, Tailwind CSS v3 |
| Service Worker | Chrome `background.js` (MV3 service worker) |
| Backend | Node.js, Express 4 |
| AI Model | OCI Generative AI — Llama 3.3 70B Instruct |
| Auth | OCI Instance Principal (no credentials in code) |
| Session store | In-memory Map (demo scope) |
| CSS pipeline | Tailwind CLI (`npm run build:css`) |

---

## Project Structure

```
.
├── backend/
│   ├── server.js          # Express API + OCI GenAI integration
│   └── package.json
├── extension/
│   ├── manifest.json      # MV3 manifest
│   ├── background.js      # Service worker — HTTP proxy
│   ├── content/
│   │   ├── config.js
│   │   ├── state.js
│   │   ├── ui.js
│   │   ├── text-extraction.js
│   │   ├── api.js
│   │   ├── analyzer.js
│   │   └── init.js
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   ├── input.css      # Tailwind source
│   │   └── tailwind.css   # Generated — do not edit manually
│   ├── pictures/
│   │   ├── rethinkLogo.png
│   │   └── rethinkLogoBrain.png
│   ├── package.json
│   └── tailwind.config.js
├── api-contract.md        # API source of truth
├── projectPlan.md         # Full project plan + status
└── claudeMemory.md        # Running architecture context
```

---

## Setup

### Backend

```bash
cd backend
npm install
cp .env.example .env   # then fill in API_SECRET and ALLOWED_EXTENSION_ID
node server.js         # or: pm2 start server.js --name ai-companion
```

The server listens on port `3000`.

**Environment variables** (set in `backend/.env`):
| Variable | Required | Description |
|---|---|---|
| `API_SECRET` | Recommended | Shared bearer token — requests without it get a 401 |
| `ALLOWED_EXTENSION_ID` | Recommended | Your Chrome extension ID — locks CORS to your extension only |
| `PORT` | No | Defaults to `3000` |

Generate a token: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### Extension

1. **Set the API secret** in `extension/background.js` (line 11) — match the value you put in `backend/.env`:
   ```js
   const API_SECRET = "your-secret-here"; // do not commit this value
   ```

2. **Build the CSS** (required after any popup change):

   ```bash
   cd extension
   npm install
   npm run build:css
   ```

3. **Load in Chrome:**
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** → select the `extension/` folder
   - Copy the extension ID shown and set it as `ALLOWED_EXTENSION_ID` in `backend/.env`

4. Navigate to any `https://docs.google.com/document/...` URL and start typing.

---

## API Reference

Full specification: [api-contract.md](api-contract.md)

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Liveness check |
| `/analyze` | POST | Detect errors in document text, return location hint |
| `/chat` | POST | Socratic response using stored session context |

**POST /analyze — request**
```json
{
  "sessionId": "uuid or null",
  "subject": "writing | math | science | other",
  "fullText": "...",
  "newContent": "most recent sentence"
}
```

**POST /analyze — response**
```json
{
  "sessionId": "uuid",
  "hasError": true,
  "location": "the third sentence"
}
```

**POST /chat — request**
```json
{
  "sessionId": "uuid",
  "message": "I don't see anything wrong with it"
}
```

**POST /chat — response**
```json
{
  "reply": "What does the problem say about the direction of the force?"
}
```

---

## Key Technical Notes

### Google Docs text extraction

Google Docs renders text on a `<canvas>` element — there are no DOM text nodes to read. The only reliable approach is:

```js
fetch(`https://docs.google.com/document/d/${docId}/export?format=txt`, {
  credentials: "same-origin"   // NOT "include" — causes CORS error on redirect
})
```

### Mixed-content bypass

Content scripts run in the HTTPS Google Docs context and cannot fetch HTTP endpoints directly. All backend calls are routed through `background.js` (the MV3 service worker), which is exempt from mixed-content restrictions.

### Tailwind CSS in MV3

Chrome's CSP blocks external CDN scripts on extension pages. Tailwind must be built locally and the output committed. Run `npm run build:css` from `extension/` after any popup change.

---

## Hackathon Context

Built for the **University of Michigan AI Business Hackathon** — theme: *AI for Education*.

The design philosophy aligns with the hackathon's goals of enhancing learning while remaining fair and transparent:
- The AI never completes the student's work
- It surfaces mistakes only after the student has written a complete thought
- Guidance is always question-based, keeping the student in the problem-solving loop
- The student can turn it off entirely

---

<p align="center">
  <img src="extension/pictures/rethinkLogoBrain.png" alt="Rethink AI" width="48" />
  <br/>
  <em>Think it through. Rethink it better.</em>
</p>
