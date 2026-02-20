# API Contract — AI Learning Companion Backend

This document is the source of truth for the backend API.
**Both engineers must agree on this before writing any code.**
Engineer 2 (Extension) can use the mock responses in this document to build and test the frontend independently while the real backend is being built.

---

## Base URL

```
http://<oci-instance-ip>:3000
```

Replace `<oci-instance-ip>` with the public IP of the OCI Compute instance once it is live.
During local development: `http://localhost:3000`

---

## Request & Response Format

- All request bodies: `Content-Type: application/json`
- All responses: `Content-Type: application/json`
- All timestamps: ISO 8601 string (`"2026-02-19T14:30:00.000Z"`)

---

## CORS Configuration

Chrome extensions have a special origin format. The backend must allow:

```
chrome-extension://*
http://localhost:*
```

Express config (Engineer 1 implements this):
```javascript
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.startsWith('chrome-extension://') || origin.startsWith('http://localhost')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
```

---

## Session Design — Important Concept

A **session** represents one work session for a student on a document.
It is created the first time `/analyze` is called with no `sessionId`.

### The "Private Error" Pattern

This is the core design insight that makes the Socratic guidance work:

```
Extension                     Backend                      LLM
    |                             |                          |
    |-- POST /analyze ----------->|                          |
    |   (text, subject)           |-- prompt: "find errors"->|
    |                             |<- { error: "sign flip",  |
    |                             |    location: "line 3" }  |
    |                             |                          |
    |                             | STORES internally in DB: |
    |                             |   errorInternal = "sign flip on x term"
    |                             |   errorLocation = "line 3"
    |                             |                          |
    |<- { hasError: true,         |                          |
    |     location: "line 3",     |  <-- errorInternal is    |
    |     sessionId: "abc" }      |      NEVER sent here     |
    |                             |                          |
    |-- POST /chat -------------->|                          |
    |   ("I don't get it")        | builds prompt with:      |
    |                             |   - the actual error     |
    |                             |   - "do NOT reveal it"   |
    |                             |-- Socratic prompt ------>|
    |<- { reply: "What rule..." } |<- guided hint ----------|
```

**Key rule:** `errorInternal` is stored in the database and injected into the LLM prompt for `/chat`. It is **never** included in any JSON response sent to the extension.

---

## Session Lifecycle

```
Extension turned ON  →  first /analyze call with no sessionId
                           → backend creates session, returns sessionId
                           → extension stores sessionId in chrome.storage.local

Subsequent /analyze calls  →  pass existing sessionId
                              → backend updates session with new error context

Extension turned OFF  →  extension clears sessionId from chrome.storage.local
                         → next ON creates a new session
```

---

## Endpoints

---

### `GET /health`

Health check. Used to verify the server is running.

**Request:** No body.

**Response `200`:**
```json
{
  "status": "ok",
  "timestamp": "2026-02-19T14:30:00.000Z"
}
```

**Mock response for Engineer 2:** Use the above exactly.

---

### `POST /analyze`

Analyzes newly completed content (a sentence or math line) for mistakes.
Creates a new session if `sessionId` is `null` or omitted.

**Request body:**
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "subject": "writing",
  "fullText": "The mitochondria is the powerhouse of the cell. It produces ATP through a process called cellular respiration. The nucleus controls protein synthesis.",
  "newContent": "The nucleus controls protein synthesis."
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `sessionId` | `string \| null` | No | Omit or set `null` on first call. Backend creates session and returns new ID. |
| `subject` | `string` | Yes | One of: `"writing"`, `"math"`, `"science"`, `"other"` |
| `fullText` | `string` | Yes | The entire document text so far. Gives the LLM context. |
| `newContent` | `string` | Yes | Only the newly completed sentence or line. This is what gets analyzed. |

**Response `200` — error found:**
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "hasError": true,
  "location": "In sentence 3 of your current paragraph."
}
```

**Response `200` — no error:**
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "hasError": false
}
```

| Response field | Type | Notes |
|---|---|---|
| `sessionId` | `string` | Always returned. Extension must save this if it was just created. |
| `hasError` | `boolean` | Whether a mistake was detected. |
| `location` | `string` | Only present when `hasError: true`. A location hint with NO description of the error. |

**Location string format examples:**
- Writing: `"In sentence 2 of your current paragraph."` or `"In your most recent sentence."`
- Math: `"On line 3 of your solution."` or `"In the most recent step."`

**What is stored internally in the session (NOT returned):**
- The actual error description from the LLM (e.g., `"The student stated the nucleus controls protein synthesis, but this function belongs to ribosomes."`)
- The full text at the time of analysis (for chat context)

**Error response `400`:**
```json
{
  "error": "Missing required field: subject",
  "code": "MISSING_FIELD"
}
```

**Error response `500`:**
```json
{
  "error": "LLM service unavailable",
  "code": "LLM_ERROR"
}
```

**Mock responses for Engineer 2:**
```javascript
// In your mock, alternate between these to test both UI states:

// Mock A — error found (use this to test notification)
{
  "sessionId": "mock-session-001",
  "hasError": true,
  "location": "In sentence 2 of your current paragraph."
}

// Mock B — no error
{
  "sessionId": "mock-session-001",
  "hasError": false
}

// Mock C — math error
{
  "sessionId": "mock-session-001",
  "hasError": true,
  "location": "On line 3 of your solution."
}
```

---

### `POST /chat`

Send a student message and receive Socratic guidance in return.
The backend uses the internally stored `errorInternal` to guide the LLM without revealing the answer.

**Request body:**
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "I re-read the sentence but I still can't figure out what's wrong."
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `sessionId` | `string` | Yes | Must be a valid session from a prior `/analyze` call. |
| `message` | `string` | Yes | The student's message to the AI tutor. |

**Response `200`:**
```json
{
  "reply": "You are on the right track! Think about what organelle is responsible for making proteins. Is that the same one you mentioned in your sentence?"
}
```

**Error response `400` — session not found:**
```json
{
  "error": "Session not found or expired",
  "code": "INVALID_SESSION"
}
```

**Error response `400` — no active error in session:**
```json
{
  "error": "No active error context for this session. Ask the student to continue writing.",
  "code": "NO_ACTIVE_ERROR"
}
```

**Mock responses for Engineer 2:**
```javascript
// Cycle through these to simulate a multi-turn Socratic conversation:

// Turn 1 — vague hint
{ "reply": "That's a good start. Think carefully about which organelle is responsible for making proteins. Is it the one you mentioned?" }

// Turn 2 — slightly more specific
{ "reply": "Protein synthesis involves building proteins from amino acids. What cellular structure is known for doing that — hint: think about ribosomes vs the nucleus." }

// Turn 3 — closer but still not the answer
{ "reply": "You are almost there. Ribosomes are where protein synthesis actually occurs. How does that compare to what you wrote in your sentence?" }
```

---

## Error Codes Reference

| Code | HTTP Status | Meaning |
|---|---|---|
| `MISSING_FIELD` | 400 | A required request field is absent or null |
| `INVALID_SUBJECT` | 400 | `subject` is not one of the allowed values |
| `INVALID_SESSION` | 400 | `sessionId` does not exist in the database |
| `NO_ACTIVE_ERROR` | 400 | `/chat` called but no error has been detected in this session yet |
| `LLM_ERROR` | 500 | OCI Generative AI call failed |
| `DB_ERROR` | 500 | Database read/write failed |
| `INTERNAL_ERROR` | 500 | Catch-all for unexpected server errors |

---

## Database Schema

OCI Autonomous Database (Oracle SQL).

```sql
-- Stores one row per student work session
CREATE TABLE sessions (
  id           VARCHAR2(36)   PRIMARY KEY,           -- UUID v4
  subject      VARCHAR2(20)   NOT NULL,              -- writing/math/science/other
  full_text    CLOB,                                 -- document text at last analyze call
  error_internal CLOB,                              -- actual error (NEVER sent to client)
  error_location VARCHAR2(500),                     -- user-facing location string
  has_active_error NUMBER(1)  DEFAULT 0,            -- 0 = false, 1 = true
  created_at   TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
);

-- Stores every chat message in a session
CREATE TABLE chat_messages (
  id           NUMBER         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id   VARCHAR2(36)   NOT NULL REFERENCES sessions(id),
  role         VARCHAR2(10)   NOT NULL,             -- 'user' or 'assistant'
  content      CLOB           NOT NULL,
  created_at   TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);
```

---

## How the Backend Uses Sessions Internally

### On `POST /analyze`

```
1. If sessionId is null → generate new UUID, create row in sessions table
2. Call OCI Generative AI with the analyze system prompt
3. Parse LLM response:
     { hasError: true/false, internalError: "...", location: "..." }
4. If hasError:
     UPDATE sessions SET
       error_internal = internalError,
       error_location = location,
       has_active_error = 1,
       full_text = fullText,
       updated_at = NOW()
     WHERE id = sessionId
5. Return to extension:
     { sessionId, hasError, location }  ← internalError is NOT included
```

### On `POST /chat`

```
1. Look up session by sessionId
2. If not found → return INVALID_SESSION error
3. If has_active_error = 0 → return NO_ACTIVE_ERROR error
4. Fetch all prior chat_messages for this session (ordered by created_at)
5. Build LLM prompt:
     System: "You are a Socratic tutor.
              The student's work: [full_text]
              The mistake they made: [error_internal]  ← injected here
              Do NOT reveal this mistake directly.
              Guide them step by step with questions."
     Messages: [all prior turns] + new user message
6. Call OCI Generative AI
7. Save user message + assistant reply to chat_messages table
8. Return { reply: assistantReply }
```

---

## Extension-Side Session Management (Engineer 2)

```javascript
// On extension startup / toggle ON:
const { sessionId } = await chrome.storage.local.get('sessionId');
// sessionId may be null if first time or after toggle OFF

// After first /analyze response:
await chrome.storage.local.set({ sessionId: response.sessionId });

// On every subsequent /analyze or /chat call:
const { sessionId } = await chrome.storage.local.get('sessionId');
// pass it in the request body

// On extension toggle OFF:
await chrome.storage.local.remove('sessionId');
```

---

## Subject Values

| Value | Use when |
|---|---|
| `"writing"` | Essays, reports, English composition |
| `"math"` | Equations, proofs, arithmetic |
| `"science"` | Biology, chemistry, physics — factual accuracy |
| `"other"` | Anything else — general logical/factual checking |

---

## Changelog

| Date | Change |
|---|---|
| 2026-02-19 | Initial contract created |
