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
| Error notification style | Location hint only — e.g., "There may be an error in sentence 2" or "Check line 4 of your solution" |
| Analysis trigger (writing) | After a full sentence is completed (period, `?`, `!`, or newline) |
| Analysis trigger (math) | After a line is completed (newline / Enter key) |
| Subject context | student sets it in the extension popup (Writing / Math / Science / Other) |
| Socratic chat | Progressive hints — each message gets slightly more specific, never gives the answer |
| Extension toggle | On/Off switch in popup — students control when it's active |

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Chrome Extension | Manifest V3, Vanilla JS (content script) + React (popup/chat UI) | MV3 is the current standard; React makes the chat UI clean and fast to build |
| Backend API | Node.js + Express | Fast to scaffold, widely known, easily deployable |
| AI Engine | OCI Generative AI — Llama 3.3 70B | Hosted on Oracle (required), strong reasoning, good instruction-following |
| Database | OCI Autonomous Database (ATP) | Free tier, stores session/conversation history |
| Hosting | OCI Compute — VM.Standard.A1.Flex (Ubuntu 22.04) | Free tier Arm instance, more than enough for a hackathon backend |
| Networking | OCI VCN + Public Subnet + Internet Gateway + Security List | Standard OCI networking stack |

---

## System Architecture

```
┌─────────────────────────────────────────────┐
│           Chrome Extension (Browser)         │
│                                              │
│  content.js                                  │
│  ├── Watches Google Docs DOM for text        │
│  ├── Detects sentence/line completion        │
│  └── Sends text to backend API               │
│                                              │
│  popup (React)                               │
│  ├── On/Off toggle                           │
│  ├── Subject selector (Writing/Math/etc.)    │
│  └── Chat interface (Socratic guidance)      │
└──────────────────┬──────────────────────────┘
                   │ HTTPS POST
                   ▼
┌─────────────────────────────────────────────┐
│         Backend API (OCI Compute)            │
│         Node.js / Express                    │
│                                              │
│  POST /analyze  ← receives text, subject    │
│  POST /chat     ← receives chat message     │
│                                              │
│  ├── Validates & formats prompt             │
│  ├── Calls OCI Generative AI (signed req)   │
│  └── Returns structured JSON response       │
└──────────────────┬──────────────────────────┘
                   │ OCI SDK (signed)
                   ▼
┌─────────────────────────────────────────────┐
│         OCI Generative AI                    │
│         Llama 3.3 70B                        │
│                                              │
│  System prompt enforces Socratic behavior:  │
│  - Detect error: yes/no + location only     │
│  - Chat: guide step by step, never answer   │
└─────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│         OCI Autonomous Database (ATP)        │
│         Stores: sessions, chat history       │
└─────────────────────────────────────────────┘
```

---

## API Contract

See `api-contract.md` for the full formal contract. It is the source of truth for both engineers and includes:
- All endpoint specs (`/health`, `/analyze`, `/chat`)
- Session lifecycle and the "private error" pattern
- Database schema
- CORS configuration
- Mock responses for Engineer 2 to use while the backend is being built
- Error codes reference

---

## Work Division — 2 Engineers

These two tracks run **in parallel** after Phase 1 is complete.

### Engineer 1 — Backend & OCI Infrastructure

| Task | Details |
|---|---|
| OCI Networking setup | Create VCN, public subnet, internet gateway, security list (ports 22, 80, 443, 3000) |
| OCI Compute instance | Launch Ubuntu 22.04 A1.Flex VM, SSH keys, assign public IP |
| Backend scaffold | Node.js + Express project, `/analyze` and `/chat` routes, CORS config |
| OCI Generative AI integration | Install OCI SDK, configure auth (`~/.oci/config`), wire up LLM calls |
| Prompt engineering | Write and test system prompts for both mistake detection and Socratic chat |
| Database setup | Create Autonomous DB instance, create sessions and messages tables, connect from backend |
| Deploy & expose | Run backend on the OCI instance, set up process manager (pm2), verify HTTPS or HTTP access |

### Engineer 2 — Chrome Extension & Frontend

| Task | Details |
|---|---|
| Extension scaffold | Set up Manifest V3 project structure (`manifest.json`, `content.js`, `background.js`, `popup/`) |
| Google Docs text extraction | Content script using MutationObserver on the Google Docs accessibility DOM layer to extract text |
| Trigger logic | Detect sentence completion (`.`, `?`, `!`, newline) for writing; line completion (Enter) for math |
| Backend communication | `fetch()` calls from content script to backend `/analyze` endpoint |
| Error notification UI | Non-intrusive toast/banner in the corner of the page showing the location hint |
| Popup UI (React) | On/Off toggle, subject selector dropdown, chat window that calls `/chat` endpoint |
| Session management | Generate/store `sessionId` in `chrome.storage.local`, pass it with every API call |
| Mock backend | While backend is being built, use hardcoded mock responses to develop and test the UI |

---

## Build Phases

### Phase 1 — Setup & API Contract (Both Engineers Together)
- Both engineers read this plan and agree on the API contract above
- Set up the shared code repository (GitHub)
- Eng 1: Creates OCI Compute instance and verifies SSH access
- Eng 2: Sets up Chrome Extension project structure and loads it as an unpacked extension locally
- Together: Agree on final API shape, create mock responses for Eng 2 to use

### Phase 2 — Parallel Development (Engineers work independently)

**Eng 1 builds:**
1. Express server with `/analyze` and `/chat` routes returning hardcoded responses first
2. OCI Generative AI connection — basic LLM call working
3. Prompt engineering — iterate on system prompts until behavior is correct
4. Database tables and connection
5. Wire everything together, deploy to OCI

**Eng 2 builds:**
1. Chrome extension manifest and project structure
2. Google Docs text extraction (hardest part — test this early)
3. Sentence/line completion detection logic
4. Toast notification UI
5. Popup with toggle, subject selector, and chat UI (using mock backend)

### Phase 3 — Integration
- Point extension at real backend URL
- End-to-end test: write a sentence with an intentional mistake → verify notification appears
- End-to-end test: send chat messages → verify Socratic responses
- Fix integration bugs

### Phase 4 — Polish & Demo Prep
- Refine notification UI (styling, animation)
- Refine Socratic prompt behavior (test many edge cases)
- Prepare the two demo scenarios (math equation mistake, biology essay mistake)
- Rehearse the demo flow
- Prepare pitch talking points

---

## Google Docs Text Extraction — Technical Detail

This is the highest-risk technical challenge. Tackle it **first** in Phase 2.

Google Docs renders text in a canvas-based editor with a hidden accessibility DOM. The most reliable approach for an extension content script:

```javascript
// The accessible text content lives here:
const editor = document.querySelector('.kix-appview-editor');
// Use MutationObserver to watch for changes
const observer = new MutationObserver((mutations) => {
  const text = extractText(); // walk the aria/accessibility tree
  checkForCompletedSentence(text);
});
observer.observe(editor, { childList: true, subtree: true });
```

The text can also be extracted from elements with `role="textbox"` or from `.kix-lineview` elements that represent lines of text in the document.

**Fallback:** If DOM extraction proves unstable, use `document.execCommand` clipboard trick — programmatically select all and read from clipboard. This is a last resort.

---

## Socratic Prompt Engineering — Guidelines

The most important piece of the project. The LLM system prompt must enforce these rules strictly:

**For `/analyze` (mistake detection):**
- Role: "You are a strict error detector for student work."
- Task: "Determine if the provided sentence/line contains a factual, logical, or mathematical error."
- Output format: Structured JSON — `{ "hasError": true/false, "location": "..." }`
- Constraint: "Do NOT describe what the error is. Only confirm it exists and give a location."

**For `/chat` (Socratic guidance):**
- Role: "You are a Socratic tutor. You never give direct answers."
- Rule 1: "Each response should guide the student one step closer to finding the answer themselves."
- Rule 2: "Ask a question that makes the student think, rather than stating the answer."
- Rule 3: "If the student is very stuck after multiple messages, give a slightly larger hint — but never the full answer."
- Rule 4: "If the student directly asks 'just tell me the answer', respond: 'I know you can figure this out. Let's try one more thing...'"

---

## Suggested AI Tools for Development

| Tool | Use Case |
|---|---|
| **Claude Code (this)** | Architecture decisions, complex code generation, debugging, OCI setup guidance |
| **GitHub Copilot** | Inline code completion while writing backend routes and extension logic |
| **v0.dev** | Generate the React chat UI and popup components quickly from a text description |
| **Cursor** | AI-powered IDE for faster code navigation and multi-file edits |
| **Claude.ai / ChatGPT** | Iterating on and testing system prompts for the Socratic LLM behavior |
| **Perplexity** | Quick research for OCI SDK docs, Chrome Manifest V3 APIs |

---

## Repository Structure (recommended)

```
ai-learning-companion/
├── backend/
│   ├── server.js          ← Express app entry point
│   ├── routes/
│   │   ├── analyze.js     ← POST /analyze handler
│   │   └── chat.js        ← POST /chat handler
│   ├── services/
│   │   ├── ociGenAI.js    ← OCI Generative AI wrapper
│   │   └── database.js    ← Autonomous DB connection
│   ├── prompts/
│   │   ├── analyzePrompt.js   ← System prompt for error detection
│   │   └── chatPrompt.js      ← System prompt for Socratic chat
│   ├── package.json
│   └── .env               ← OCI config, DB credentials (never commit this)
│
├── extension/
│   ├── manifest.json
│   ├── content.js         ← Injected into Google Docs tabs
│   ├── background.js      ← Service worker
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.jsx      ← React component (toggle + subject + chat)
│   │   └── popup.css
│   └── icons/
│
├── claudeMemory.md        ← Running context for AI assistant sessions
├── projectPlan.md         ← This file
└── README.md
```

---

## Demo Script (for presentation)

**Scenario 1 — Math:**
1. Open Google Docs, show the extension icon is active
2. Begin writing out steps to solve a linear equation
3. Introduce the mistake: move a term across the equals sign without flipping the sign
4. Press Enter to complete the line
5. Show the notification: *"There may be an error on line 3 of your solution."*
6. Student "doesn't see it" → opens chat
7. Chat: AI asks "What rule applies when you move a term across an equals sign?"
8. Student realizes the mistake and corrects it

**Scenario 2 — Biology Essay:**
1. Open Google Docs, set subject to "Writing/Science" in popup
2. Write a paragraph with one factually incorrect sentence (e.g., wrong cell organelle function)
3. Complete the sentence with a period
4. Show notification: *"Sentence 2 in this paragraph may contain a factual inaccuracy."*
5. Student re-reads and is unsure → opens chat
6. Chat: AI asks "What is the primary function of the organelle you mentioned?"
7. Student realizes the error and corrects it

---

## Project Status Tracker

- [x] Shared GitHub repo created
- [x] OCI Compute instance live and SSH accessible
- [ ] Extension loads as unpacked extension in Chrome
- [x] API contract locked in — see `api-contract.md`
- [ ] Backend `/analyze` route working (mock)
- [ ] Backend `/analyze` route wired to OCI Generative AI
- [ ] Backend `/chat` route working with Socratic prompt
- [ ] Google Docs text extraction working reliably
- [ ] Sentence/line completion trigger working
- [ ] Toast notification appearing correctly
- [ ] Extension popup UI complete (toggle + subject + chat)
- [ ] Extension connected to real backend
- [ ] End-to-end demo scenario 1 (math) working
- [ ] End-to-end demo scenario 2 (writing) working
- [ ] Demo rehearsed

Extension scaffold created

✅ Pause-trigger tooltip working on generic text fields

✅ Backend API scaffolded on laptop first (/coach)

✅ Deploy backend to OCI Compute (public HTTPS if possible)

✅ Wire extension to OCI endpoint

✅ Add OCI GenAI call in backend (keep OpenAI fallback)
