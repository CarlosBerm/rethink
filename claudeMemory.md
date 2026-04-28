# Claude Memory — AI Business Hackathon (University of Michigan)

This file maintains running context for Claude across sessions. Update it after every important planning or context discussion.

---

## Last Updated
2026-04-28 — Security hardening complete; multi-turn Socratic chat fully working end-to-end.

---

## Hackathon Prompt

> How can artificial intelligence be used to enhance learning experiences, assessment, and student well-being in education while remaining fair, transparent, and relevant to real-world needs? Participants are challenged to design an AI-driven solution that benefits students, faculty, and staff by improving learning, promoting well-being, or strengthening how learning is evaluated — while enhancing, not replacing, the human role in education.

---

## Our Project: Real-Time AI Learning Companion (Chrome Extension)

### Core Concept
A Chrome extension that monitors student work in real-time (Google Docs) and uses AI to detect mistakes. Instead of giving the answer, it notifies the student with a location hint only. If they need help, a Socratic chat guides them step by step without ever giving the solution.

### Key Principles
- **Detect, don't solve**: AI identifies that a mistake exists, not what it is (at first)
- **Socratic guidance**: Chat hints get progressively more specific, never give the answer
- **Non-intrusive**: Student toggles on/off via extension popup
- **Enhances, doesn't replace**: Student remains the active problem-solver

### Finalized Design Decisions
- **Error notification**: Location hint only — e.g., "There may be an error in sentence 2"
- **Analysis trigger (writing)**: After a full sentence is completed (`.`, `?`, `!`, newline)
- **Analysis trigger (math)**: After a line is completed (Enter / newline)
- **Subject context**: Student sets it in the extension popup (Writing / Math / Science / Other)
- **Team size**: 2 engineers — Eng 1 = backend/OCI, Eng 2 = Chrome extension/frontend

---

## Tech Stack

| Layer | Technology |
|---|---|
| Chrome Extension | Manifest V3, Vanilla JS (content scripts, 7 files) + Tailwind CSS (popup) |
| Backend API | Node.js + Express, running on OCI Compute |
| AI Engine | OCI Generative AI — Llama 3.3 70B |
| Hosting | OCI Compute — AMD Flex, 2 OCPU / 12 GB RAM, Oracle Linux |

---

## API Endpoints (see api-contract.md for full spec)

- `GET  /health`   — liveness check
- `POST /analyze`  — analyze a completed sentence/line, return location hint only
- `POST /chat`     — Socratic guidance chat using privately stored error context

### The "Private Error" Pattern (critical)
- `/analyze` → LLM detects the actual error internally → backend stores it in DB → only sends `location` hint to extension
- `/chat` → backend injects the stored private error into the LLM system prompt → guides student without revealing it
- `errorInternal` is **never** sent to the extension under any circumstances

---

## OCI Instance Info (IMPORTANT)
- **Public IP**: 64.181.214.188
- **OS**: Oracle Linux (NOT Ubuntu) — uses `dnf` not `apt`
- **SSH user**: `opc` (Oracle Linux default — NOT `ubuntu`)
- **SSH key**: stored in local `~/.ssh/` — not committed to this repo
- **SSH command**: see local notes — SSH credentials are not committed to this repo
- **Shape**: AMD Flex, 2 OCPU / 12 GB RAM
- **pm2 process**: `ai-companion`, port 3000
- **pm2 deploy**: `cd ~/rethink && git pull origin rethinkOCI && pm2 restart ai-companion`

### OCI GenAI Notes
- Auth: `InstancePrincipalsAuthenticationDetailsProviderBuilder().build()`
- Compartment OCID: auto-fetched from instance metadata
- Model: `meta.llama-3.3-70b-instruct`
- Endpoint: `https://inference.generativeai.us-chicago-1.oci.oraclecloud.com`

---

## Critical Technical Lessons

### Google Docs Text Extraction
- **Google Docs renders on `<canvas>`** — document text is NOT in any DOM text node
- All CSS selector approaches (`.kix-appview-editor`, `.kix-paragraphrenderer`, etc.) return the Gemini sidebar text or nothing
- **Working solution**: `GET https://docs.google.com/document/d/{docId}/export?format=txt` — same-origin fetch from content script, uses existing Google session cookies
- **CORS fix**: Must use `credentials: "same-origin"` NOT `credentials: "include"`. The export redirects to `googleusercontent.com` which returns `ACAO: *`, incompatible with `include` mode
- **Keyboard buffer fallback**: Tracks typed keystrokes for unsaved new documents (pre-first-save)

### Chrome Extension CSP Constraints
- Google Docs blocks inline `<script>` tag injection via CSP — cannot inject page-context scripts
- Tailwind CDN script is blocked in extension popup pages by MV3 default CSP (`script-src 'self'`)
- **Fix**: Use Tailwind CLI to generate local `popup/tailwind.css` — run `npm run build:css` in `extension/`

### Mixed-Content / HTTPS→HTTP
- Content scripts on Google Docs (HTTPS) cannot fetch `http://` backend directly
- **Fix**: Route all backend calls through `background.js` service worker (MV3 service workers are exempt from mixed-content policy)

### OCI GenAI SDK — Message Role Bug (CRITICAL)
- The OCI Node.js SDK's `Message.getJsonObj()` switch only recognizes roles: `"USER"`, `"ASSISTANT"`, `"SYSTEM"`, `"TOOL"`, `"DEVELOPER"`
- `"CHATBOT"` hits the `default` case — the role is silently dropped from the serialized object, causing the OCI REST API to reject multi-turn chat messages with a schema validation error
- **Fix**: Use `role: "ASSISTANT"` (not `"CHATBOT"`) for assistant messages in `toOciMessages()`
- **Symptom**: First chat turn succeeds; every subsequent turn fails with `LLM_ERROR` (OCI says messages[N] is missing `role`)
- `systemPrompt` is NOT a valid field on `GenericChatRequest` — system prompt must be a message with `role: "SYSTEM"` in the messages array

### Security — Backend Auth & CORS
- Backend now requires `Authorization: Bearer <token>` on all API routes (enforced if `API_SECRET` set in `.env`)
- CORS is scoped to a specific extension ID via `ALLOWED_EXTENSION_ID` in `.env` (falls back to any chrome-extension if not set)
- `backend/.env` is gitignored and lives only on the OCI server — never commit real values
- `extension/background.js` has `const API_SECRET = ""` as placeholder — set real value locally, do not commit
- To deploy a server.js change: `scp` it directly, then `pm2 restart ai-companion --update-env`
- The OCI server is on branch `rethinkOCI` — local master changes must be SCP'd or pushed/merged

---

## Extension File Structure (current)

```
extension/
├── manifest.json
├── background.js              ← service worker, proxies /analyze and /chat
├── content.js                 ← DEPRECATED (kept for reference, not loaded)
├── content/                   ← active content scripts, loaded in order
│   ├── config.js              ← all constants
│   ├── state.js               ← all mutable state
│   ├── ui.js                  ← overlay + tooltip UI
│   ├── text-extraction.js     ← /export fetch + keyboard buffer
│   ├── api.js                 ← storage helpers + callAnalyzeAPI
│   ├── analyzer.js            ← debounce + analyzeNow
│   └── init.js                ← event listeners + MutationObserver
├── popup/
│   ├── popup.html             ← Tailwind UI (toggle, subject, status, chat)
│   ├── popup.js               ← popup logic
│   ├── input.css              ← Tailwind source (@tailwind directives)
│   └── tailwind.css           ← generated, committed
├── pictures/
│   └── rethinkLogoBrain.png
├── package.json               ← devDep: tailwindcss
└── tailwind.config.js         ← scans popup/popup.html + popup.js
```

---

## Current Status

### Done — Backend (Engineer 1)
- [x] Backend running via pm2 at 64.181.214.188:3000
- [x] `/health`, `/analyze`, `/chat` all working end-to-end with OCI GenAI
- [x] In-memory session store (Map) — functional for demo
- [x] Bearer token auth middleware (`API_SECRET` env var, enforced on all routes)
- [x] CORS locked to specific extension ID (`ALLOWED_EXTENSION_ID` env var)
- [x] **Fixed**: OCI SDK message role bug — `"CHATBOT"` → `"ASSISTANT"` in `toOciMessages()`
- [x] **VERIFIED**: multi-turn chat (3+ turns) working end-to-end ✓

### Done — Extension (Engineer 2)
- [x] Manifest V3 scaffold
- [x] Google Docs text extraction via `/export?format=txt` (confirmed working)
- [x] Keyboard buffer fallback for unsaved docs
- [x] MutationObserver + keydown/keyup debounce trigger (1800ms)
- [x] Debug overlay + tooltip UI (overlay set to `false` for production)
- [x] `background.js` service worker proxying backend calls + bearer token header
- [x] Session management via `chrome.storage.local`
- [x] `activeError` state — tooltip persists until backend confirms fix
- [x] `lastResult` saved to storage so popup can display status
- [x] Content.js split into 7 focused files in `extension/content/`
- [x] Popup built: On/Off toggle, subject pills, status banner, Socratic chat
- [x] Tailwind CSS wired up with local build (`npm run build:css`)
- [x] **VERIFIED END-TO-END**: analyze + multi-turn Socratic chat fully working ✓

### Next Up — RESUME HERE in new chat
- [ ] Demo scenario prep: math equation mistake + biology essay mistake
- [ ] Polish: refine notification timing, tooltip styling
- [ ] Pitch talking points prepared

---

## Project Files
- `projectPlan.md` — Full plan: architecture, work division, build phases, demo script
- `api-contract.md` — Full API spec: endpoints, session lifecycle, DB schema, CORS, mock responses
- `claudeMemory.md` — This file (always read first)
