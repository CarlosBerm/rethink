# Claude Memory — AI Business Hackathon (University of Michigan)

This file maintains running context for Claude across sessions. Update it after every important planning or context discussion.

---

## Last Updated
2026-02-19 (updated with design decisions and project plan)

---

## Hackathon Prompt

> How can artificial intelligence be used to enhance learning experiences, assessment, and student well-being in education while remaining fair, transparent, and relevant to real-world needs? Participants are challenged to design an AI-driven solution that benefits students, faculty, and staff by improving learning, promoting well-being, or strengthening how learning is evaluated — while enhancing, not replacing, the human role in education.

---

## Our Project: Real-Time AI Learning Companion (Chrome Extension)

### Core Concept
A Chrome extension that monitors student work in real-time and uses AI to detect mistakes — but instead of providing the answer, it notifies the student that a mistake exists and guides them toward finding it themselves. This combats AI dependency by keeping the student in the problem-solving loop.

### Key Principles
- **Detect, don't solve**: The AI identifies that a mistake was made, not what the mistake is (at first)
- **Socratic guidance**: If a student asks for help, the AI guides them progressively closer without giving the answer outright
- **Non-intrusive**: Student can toggle the assistant on/off via a Chrome extension popup
- **Enhances, doesn't replace**: Keeps the human (student) as the active learner

### Use Cases (from pitch)
1. **Math (Google Docs)**: Student solves a math equation but forgets to flip signs when moving a term. AI notifies them of an error in their process. Student rechecks and fixes it (with guided chat help if needed).
2. **Essay writing (Google Docs)**: Student writes a factually inaccurate sentence in a biology essay. AI flags that the sentence isn't fully correct. If the student can't find the issue, they chat with the AI which guides them toward the correction without stating it outright.

---

## Technical Architecture

### Platform
- **Frontend**: Chrome Extension (content script + popup UI)
- **Backend**: Hosted on Oracle Cloud Infrastructure (OCI) — Compute Instance (Ubuntu, A1.Flex Arm shape)
- **AI Engine**: OCI Generative AI service (LLM — Llama 3.3 70B or Cohere Command R)
- **Database**: OCI Autonomous Database (for session/conversation history)

### Why NOT Oracle Document Understanding
Document Understanding is for OCR/scanning PDFs and images. It requires a file input and is designed for document digitization pipelines. For this project, we already have raw text from Google Docs — we need a reasoning LLM, not an OCR service.

### Correct OCI Services to Use
| Need | OCI Service |
|---|---|
| LLM reasoning/chat | OCI Generative AI (Llama 4, Llama 3.3 70B, Cohere Command A/R) |
| Backend server | OCI Compute (VM.Standard.A1.Flex, Ubuntu 22.04) |
| Database (sessions/history) | OCI Autonomous Database (ATP, free tier) |
| Networking | VCN + Public Subnet + Internet Gateway + Security List |

### Call Flow
```
Chrome Extension (content script reads Google Docs text)
  → POST to our backend API (HTTPS, running on OCI Compute)
    → OCI Generative AI Chat API (signed OCI request with private key)
      → LLM analyzes text, detects mistakes, returns Socratic guidance
  → Extension displays non-intrusive notification to student
  → Optional: Student opens chat, exchanges messages with Socratic AI
```

### Why the backend is required
- OCI auth requires HMAC-SHA256 signed requests using a private API key
- Embedding that private key in a Chrome extension would expose it publicly
- OCI endpoints block direct browser fetch calls (CORS)
- The backend acts as a secure proxy and owns all OCI credentials

---

## Key Technical Challenges to Solve

### 1. Reading Google Docs Text in Real-Time
Google Docs does NOT use standard HTML for text rendering — it uses a canvas-based approach. Getting text from a Google Docs tab requires one of:
- **MutationObserver on the accessibility tree** (most practical for extension)
- **Google Docs API** (requires OAuth, adds complexity)
- **Reading the hidden `.kix-appview-editor` DOM layer** (fragile but works)

### 2. Debouncing / When to Trigger Analysis (FINALIZED)
- **Writing**: Trigger after a full sentence is completed (`.`, `?`, `!`, or newline)
- **Math**: Trigger after a line is completed (Enter / newline)

### 3. Socratic Guidance Prompting
The LLM system prompt is critical. It must be instructed to:
- Confirm whether a mistake exists (yes/no)
- NOT reveal what the mistake is directly
- If asked for help, guide in steps — start vague, get more specific each message
- Never just give the answer

### 4. Subject Detection
The AI needs to know if the content is math, science, writing, etc. to analyze it correctly. Either:
- Auto-detect from content
- Let student set subject context in extension popup

---

## Oracle Cloud Account Info
- Tenancy: bermu12
- Region: US Midwest (Chicago) — us-chicago-1
- Account type: Hackathon pro account with credits

---

## Project Files
- `projectPlan.md` — Full project plan with architecture, engineer work split, demo script, and build phases
- `api-contract.md` — Formal API contract (source of truth for both engineers). Includes all endpoints, session lifecycle, DB schema, CORS config, mock responses, and the "private error" Socratic pattern.
- `claudeMemory.md` — This file

---

## Finalized Design Decisions
- **Error notification**: Location hint only — e.g., "There may be an error in sentence 2" or "Check line 4 of your solution." No detail about what is wrong.
- **Analysis trigger (writing)**: After a full sentence is completed (`.`, `?`, `!`, newline)
- **Analysis trigger (math)**: After a line is completed (Enter key / newline)
- **Subject context**: Student sets it in the extension popup (Writing / Math / Science / Other)
- **Team size**: 2 engineers — Eng 1 owns backend/OCI, Eng 2 owns Chrome extension/frontend

---

## Project Status
- [ ] Architecture finalized
- [ ] OCI Compute instance created
- [ ] Backend API server scaffolded
- [ ] OCI Generative AI integration built
- [ ] Chrome Extension scaffold created
- [ ] Google Docs text extraction working
- [ ] Real-time mistake detection working
- [ ] Socratic chat UI working
- [ ] End-to-end demo ready
