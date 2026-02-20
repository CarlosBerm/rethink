# Claude Memory — AI Business Hackathon (University of Michigan)

This file maintains running context for Claude across sessions. Update it after every important planning or context discussion.

---

## Last Updated
2026-02-20 — Backend fully deployed and tested. All 3 endpoints verified end-to-end with OCI GenAI.

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
- **Error notification**: Location hint only — e.g., "There may be an error in sentence 2" or "Check line 4 of your solution"
- **Analysis trigger (writing)**: After a full sentence is completed (`.`, `?`, `!`, newline)
- **Analysis trigger (math)**: After a line is completed (Enter / newline)
- **Subject context**: Student sets it in the extension popup (Writing / Math / Science / Other)
- **Team size**: 2 engineers — Eng 1 = backend/OCI, Eng 2 = Chrome extension/frontend

---

## Tech Stack

| Layer | Technology |
|---|---|
| Chrome Extension | Manifest V3, Vanilla JS (content script) + React (popup/chat UI) |
| Backend API | Node.js + Express, running on OCI Compute |
| AI Engine | OCI Generative AI — Llama 3.3 70B (OpenAI as fallback) |
| Database | OCI Autonomous Database (ATP, free tier) |
| Hosting | OCI Compute — VM.Standard.A1.Flex, Ubuntu 22.04, us-chicago-1 |

---

## API Endpoints (see api-contract.md for full spec)

- `GET  /health`   — liveness check
- `POST /analyze`  — analyze a completed sentence/line, return location hint only
- `POST /chat`     — Socratic guidance chat using privately stored error context

**Note:** teammate's local scaffold uses `/coach` as the route name — align on `/analyze` or decide which to keep.

### The "Private Error" Pattern (critical)
- `/analyze` → LLM detects the actual error internally → backend stores it in DB → only sends `location` hint to extension
- `/chat` → backend injects the stored private error into the LLM system prompt → guides student without revealing it
- `errorInternal` is **never** sent to the extension under any circumstances

---

## OCI Account Info
- Tenancy: bermu12
- Region: US Midwest (Chicago) — us-chicago-1
- Account type: Hackathon pro account with credits

---

## OCI Instance Info (IMPORTANT)
- **Public IP**: 64.181.214.188
- **OS**: Oracle Linux (NOT Ubuntu) — uses `dnf` not `apt`
- **SSH user**: `opc` (NOT `ubuntu`)
- **SSH key**: `$HOME\.ssh\hackathon_oci` (Windows path)
- **SSH command**: `ssh -i "$HOME\.ssh\hackathon_oci" opc@64.181.214.188`
- **Shape**: AMD Flex, 2 OCPU / 12 GB RAM

## Current Status (as of this handoff)

### Done (Engineer 2 — Extension)
- [x] Extension scaffold created
- [x] Pause-trigger tooltip working on generic text fields

### Done (Engineer 1 — Backend)
- [x] Backend API scaffolded on laptop (/coach route)
- [x] API contract finalized — see `api-contract.md`

### Done (Engineer 1 — OCI)
- [x] VCN + Security List created (ports 22, 80, 443, 3000 open)
- [x] Compute instance running at 64.181.214.188
- [x] SSH access working (user: opc, key: hackathon_oci)
- [x] firewalld disabled (`sudo systemctl stop firewalld && sudo systemctl disable firewalld`)
- [x] System updated (`sudo dnf update -y`)

### Done (Engineer 1 — Backend deployment)
- [x] Node.js 20, pm2, git installed on OCI instance
- [x] Repo cloned to ~/rethink on instance (branch: rethinkOCI)
- [x] Node.js Express backend built: GET /health, POST /analyze, POST /chat
- [x] OCI Generative AI integrated (Llama 3.3 70B, instance principal auth)
- [x] IAM dynamic group `hackathon-compute` + policy `hackathon-genai-policy` created
- [x] Backend running via pm2 (process name: ai-companion, port 3000)
- [x] `/health` confirmed: `{"status":"ok"}` at localhost:3000 and externally at 64.181.214.188:3000
- [x] `/analyze` tested: correctly detected science error, returned location hint only
- [x] `/chat` tested: Socratic response confirmed — did not reveal the error, guided with questions

### OCI GenAI Notes
- Auth: `InstancePrincipalsAuthenticationDetailsProviderBuilder().build()` (NOT `.create()`)
- Compartment OCID: auto-fetched from instance metadata (169.254.169.254)
- Model: `meta.llama-3.3-70b-instruct`
- Endpoint: `https://inference.generativeai.us-chicago-1.oci.oraclecloud.com`
- pm2 restart: `pm2 restart ai-companion` (run from anywhere on the instance)
- pm2 deploy: `cd ~/rethink && git pull origin rethinkOCI && pm2 restart ai-companion`

### Next Up — RESUME HERE in new chat
- [ ] Wire extension to OCI endpoint (`http://64.181.214.188:3000`)
- [ ] Integrate extension with real backend (replace any mock calls)
- [ ] End-to-end demo test: type in Google Docs → error detected → Socratic chat

---

## Project Files
- `projectPlan.md` — Full plan: architecture, work division, build phases, demo script
- `api-contract.md` — Full API spec: endpoints, session lifecycle, DB schema, CORS, mock responses
- `claudeMemory.md` — This file (always read first)
