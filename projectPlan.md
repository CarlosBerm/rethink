# Project Plan — AI Learning Companion (Hackathon)
**University of Michigan — AI Business Hackathon**
**Team size: 2 engineers**

---

## Project Summary

A Chrome extension that monitors student work on Google Docs in real-time. When a mistake is detected after a completed sentence (writing) or completed line (math), the AI notifies the student with a location hint — no detail about what is wrong. If the student needs help, they open a chat where the AI guides them toward the answer using Socratic questioning, never simply giving away the solution.

**Problem being solved:** Students are becoming dependent on AI tools that just hand them answers, which prevents real learning. This tool gives AI-assisted feedback that keeps the student in the problem-solving loop.

**Hackathon alignment:** Enhances learning, promotes student well-being, supports assessment, keeps the human role central.

---

## Finalized Design Decisions

| Decision | Choice |
|---|---|
| Error notification style | Location hint only — e.g., "There may be an error in sentence 2" |
| Analysis trigger (writing) | After a full sentence is completed (period, `?`, `!`, or newline) |
| Analysis trigger (math) | After a line is completed (newline / Enter key) |
| Subject context | Student sets it in the extension popup (Writing / Math / Science / Other) |
| Socratic chat | Progressive hints — each message gets slightly more specific, never gives the answer |
| Extension toggle | On/Off switch in popup — students control when it's active |

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Chrome Extension | Manifest V3, Vanilla JS (7 content script files) + Tailwind CSS | MV3 standard; split files for readability; Tailwind for consistent styling |
| Backend API | Node.js + Express | Fast to scaffold, widely known, easily deployable |
| AI Engine | OCI Generative AI — Llama 3.3 70B | Hosted on Oracle (required), strong reasoning |
| Hosting | OCI Compute — AMD Flex, 2 OCPU / 12 GB, Oracle Linux, 64.181.214.188 | Free tier OCI instance |
| Networking | OCI VCN + Public Subnet + Internet Gateway + Security List | Standard OCI networking |

---

## System Architecture

```
┌─────────────────────────────────────────────┐
│           Chrome Extension (Browser)         │
│                                              │
│  content/ (7 files, shared global scope)     │
│  ├── config.js    — constants                │
│  ├── state.js     — mutable state            │
│  ├── ui.js        — overlay + tooltip        │
│  ├── text-extraction.js — /export fetch      │
│  ├── api.js       — storage + callAnalyze    │
│  ├── analyzer.js  — debounce + analyzeNow    │
│  └── init.js      — event listeners + MO     │
│                                              │
│  popup/ (Tailwind CSS)                       │
│  ├── On/Off toggle                           │
│  ├── Subject selector (Writing/Math/etc.)    │
│  ├── Status banner (last analysis result)    │
│  └── Chat interface (Socratic guidance)      │
│                                              │
│  background.js (service worker)              │
│  └── Proxies HTTP calls to bypass            │
│      mixed-content block (HTTPS→HTTP)        │
└──────────────────┬──────────────────────────┘
                   │ HTTP POST (via background.js)
                   ▼
┌─────────────────────────────────────────────┐
│         Backend API (OCI Compute)            │
│         Node.js / Express — port 3000        │
│                                              │
│  POST /analyze  ← receives text, subject    │
│  POST /chat     ← receives chat message     │
│                                              │
│  ├── Validates & formats prompt             │
│  ├── Calls OCI Generative AI (signed req)   │
│  └── Returns structured JSON response       │
└──────────────────┬──────────────────────────┘
                   │ OCI SDK (instance principal auth)
                   ▼
┌─────────────────────────────────────────────┐
│         OCI Generative AI                    │
│         meta.llama-3.3-70b-instruct          │
│                                              │
│  /analyze: detect error → return location   │
│  /chat: Socratic guidance, never give answer │
└─────────────────────────────────────────────┘
```

---

## API Contract

See `api-contract.md` for the full formal contract. Includes:
- All endpoint specs (`/health`, `/analyze`, `/chat`)
- Session lifecycle and the "private error" pattern
- Database schema, CORS config, mock responses, error codes

---

## Work Division — 2 Engineers

### Engineer 1 — Backend & OCI Infrastructure (COMPLETE)
| Task | Status |
|---|---|
| OCI Networking setup | ✅ Done |
| OCI Compute instance | ✅ Done — 64.181.214.188, pm2 `ai-companion` |
| Backend scaffold | ✅ Done |
| OCI Generative AI integration | ✅ Done — Llama 3.3 70B, instance principal auth |
| Prompt engineering | ✅ Done |
| Session store | ✅ In-memory Map (sufficient for demo) |
| Deploy & expose | ✅ Done — port 3000 open |

### Engineer 2 — Chrome Extension & Frontend
| Task | Status |
|---|---|
| Extension scaffold (Manifest V3) | ✅ Done |
| Google Docs text extraction | ✅ Done — `/export?format=txt` endpoint |
| Trigger logic (debounce + sentence detection) | ✅ Done |
| Backend communication via background.js | ✅ Done |
| Error notification tooltip | ✅ Done |
| Session management (chrome.storage.local) | ✅ Done |
| Content.js split into 7 focused files | ✅ Done |
| Tailwind CSS build pipeline | ✅ Done |
| Popup UI (toggle + subject + status + chat) | ✅ Built — debugging needed |
| End-to-end Socratic chat from popup | ⬜ Pending |

---

## Build Phases

### Phase 1 — Setup & API Contract ✅ Complete
### Phase 2 — Parallel Development ✅ Complete
### Phase 3 — Integration ⬜ In Progress
- [x] Text extraction working end-to-end (export endpoint confirmed)
- [x] `/analyze` E2E: "Babies have an average height of 5 feet." → `hasError: true` ✓
- [x] `/analyze` E2E: "Babies are born after 9 months of pregnancy." → `hasError: false` ✓
- [ ] Popup working: toggle + subject selector saving correctly
- [ ] Chat flow: error detected → popup → Socratic reply confirmed

### Phase 4 — Polish & Demo Prep ⬜ Up Next
- [ ] Fix and verify popup
- [ ] End-to-end Socratic chat demo rehearsed
- [ ] Demo scenario 1 (math equation mistake) rehearsed
- [ ] Demo scenario 2 (biology essay mistake) rehearsed
- [ ] Notification timing + tooltip style polish
- [ ] Pitch talking points prepared

---

## Key Technical Notes

### Google Docs Text Extraction (solved)
Google Docs renders entirely on `<canvas>` — document text is **not** in any DOM text nodes.
The **only working approach**: fetch the document's plain-text export endpoint:
```
GET https://docs.google.com/document/d/{docId}/export?format=txt
```
- `credentials: "same-origin"` — NOT `"include"` (causes CORS error on redirect to googleusercontent.com)
- Same-origin from content script context — uses user's existing Google session cookies
- 5-second cache (`EXPORT_TTL`) avoids hammering on every keystroke
- Keyboard buffer fallback for unsaved new documents

### Tailwind CSS Build
After changing any class names in `popup.html` or `popup.js`:
```bash
cd extension && npm run build:css
```
Commit `popup/tailwind.css` alongside HTML/JS changes.

### Mixed-Content Bypass
Google Docs is HTTPS; backend is HTTP. Browsers block HTTPS→HTTP fetch from content scripts.
Fix: all backend calls route through `background.js` service worker (exempt from mixed-content).

---

## Repository Structure (current)

```
ai-learning-companion/
├── backend/
│   ├── server.js              ← Express app (GET /health, POST /analyze, POST /chat)
│   └── package.json
│
├── extension/
│   ├── manifest.json          ← MV3, lists 7 content scripts in order
│   ├── background.js          ← service worker, proxies /analyze and /chat
│   ├── content/               ← active content scripts (loaded in order)
│   │   ├── config.js
│   │   ├── state.js
│   │   ├── ui.js
│   │   ├── text-extraction.js
│   │   ├── api.js
│   │   ├── analyzer.js
│   │   └── init.js
│   ├── popup/
│   │   ├── popup.html         ← Tailwind UI
│   │   ├── popup.js
│   │   ├── input.css          ← Tailwind source
│   │   └── tailwind.css       ← generated (committed)
│   ├── pictures/
│   │   └── rethinkLogoBrain.png
│   ├── package.json           ← devDep: tailwindcss
│   └── tailwind.config.js
│
├── claudeMemory.md
├── projectPlan.md
└── api-contract.md
```

---

## Demo Script (for presentation)

**Scenario 1 — Math:**
1. Open Google Docs, show extension icon is active
2. Write steps to solve a linear equation, introduce a sign error
3. Press Enter — notification: *"There may be an error on line 3 of your solution."*
4. Open popup → Chat: "What rule applies when you move a term across an equals sign?"
5. Student corrects the mistake

**Scenario 2 — Biology Essay:**
1. Open Google Docs, set subject to "Science" in popup
2. Write a paragraph with a factually incorrect sentence (wrong organelle function)
3. Complete sentence — notification: *"Sentence 2 may contain a factual inaccuracy."*
4. Open popup → Chat: "What is the primary function of the organelle you mentioned?"
5. Student corrects the mistake

---

## Socratic Prompt Engineering

**For `/analyze`:** Return `{ "hasError": bool, "location": "..." }` — never describe the error itself.

**For `/chat`:** Socratic tutor rules:
1. Each reply guides one step closer, never gives the answer
2. Ask a question, don't state the answer
3. If very stuck, give a slightly larger hint — but still not the answer
4. If student asks "just tell me": "I know you can figure this out. Let's try one more thing…"
