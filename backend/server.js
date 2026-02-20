const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ---- CORS ----
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

app.use(express.json());

// ---- In-memory session store ----
// sessions[id] = { subject, fullText, errorInternal, errorLocation, hasActiveError, chatHistory[] }
const sessions = new Map();

// ---- LLM client ----
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

// ---- Prompt builders ----

const SUBJECT_CONTEXT = {
  writing: 'grammar, factual accuracy, logical consistency, and clarity',
  math: 'mathematical correctness, calculation errors, and logical steps in equations or proofs',
  science: 'scientific accuracy and factual correctness in biology, chemistry, or physics',
  other: 'logical consistency, factual accuracy, and general correctness'
};

function buildAnalyzeSystemPrompt(subject) {
  const ctx = SUBJECT_CONTEXT[subject] || SUBJECT_CONTEXT.other;
  return `You are an educational error-detection assistant. Analyze student work for ${ctx}.

You will receive:
- fullText: the complete document (for context only)
- newContent: the newly completed sentence or line (what to actually check)

Respond ONLY with valid JSON — no other text.

If an error exists in newContent:
{"hasError": true, "internalError": "<detailed description of the actual error, for tutor use only>", "location": "<vague location hint — e.g. 'In your most recent sentence.' or 'On the most recent step.' Never describe what the error is, only where to look.>"}

If no error:
{"hasError": false}

Rules:
- Only check newContent for errors; use fullText for context
- The location string must NEVER hint at WHAT the error is — only WHERE
- internalError must be detailed enough for a Socratic tutor to guide the student`;
}

function buildChatSystemPrompt(session) {
  return `You are a Socratic tutor helping a student find and correct their own mistake.

Student's work:
"""
${session.fullText}
"""

The mistake the student made (DO NOT reveal this directly under any circumstances):
"""
${session.errorInternal}
"""

Rules:
1. NEVER directly state what the error is
2. Guide only with questions — help the student discover the error themselves
3. Start with broad questions; get more specific only if the student is stuck after multiple turns
4. Be encouraging, patient, and supportive
5. If the student correctly identifies the error, warmly confirm they are on the right track
6. Keep responses to 2–3 sentences`;
}

// ---- Routes ----

// GET /health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// POST /analyze
app.post('/analyze', async (req, res) => {
  const { sessionId, subject, fullText, newContent } = req.body;

  // Validation
  if (!subject) return res.status(400).json({ error: 'Missing required field: subject', code: 'MISSING_FIELD' });
  if (!fullText) return res.status(400).json({ error: 'Missing required field: fullText', code: 'MISSING_FIELD' });
  if (!newContent) return res.status(400).json({ error: 'Missing required field: newContent', code: 'MISSING_FIELD' });

  const validSubjects = ['writing', 'math', 'science', 'other'];
  if (!validSubjects.includes(subject)) {
    return res.status(400).json({ error: `Invalid subject. Must be one of: ${validSubjects.join(', ')}`, code: 'INVALID_SUBJECT' });
  }

  // Resolve or create session
  let sid = sessionId;
  if (!sid || !sessions.has(sid)) {
    sid = uuidv4();
    sessions.set(sid, {
      subject,
      fullText: '',
      errorInternal: null,
      errorLocation: null,
      hasActiveError: false,
      chatHistory: []
    });
  }

  const session = sessions.get(sid);
  session.fullText = fullText;

  // Call LLM
  let llmResult;
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: buildAnalyzeSystemPrompt(subject) },
        {
          role: 'user',
          content: `Full text:\n"""\n${fullText}\n"""\n\nNewly completed content to analyze:\n"""\n${newContent}\n"""`
        }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });
    llmResult = JSON.parse(completion.choices[0].message.content);
  } catch (err) {
    console.error('LLM error on /analyze:', err.message);
    return res.status(500).json({ error: 'LLM service unavailable', code: 'LLM_ERROR' });
  }

  // Update session and respond
  if (llmResult.hasError) {
    session.errorInternal = llmResult.internalError;
    session.errorLocation = llmResult.location;
    session.hasActiveError = true;
    session.chatHistory = []; // reset chat on each new detected error
    return res.json({ sessionId: sid, hasError: true, location: llmResult.location });
  } else {
    return res.json({ sessionId: sid, hasError: false });
  }
});

// POST /chat
app.post('/chat', async (req, res) => {
  const { sessionId, message } = req.body;

  if (!sessionId) return res.status(400).json({ error: 'Missing required field: sessionId', code: 'MISSING_FIELD' });
  if (!message) return res.status(400).json({ error: 'Missing required field: message', code: 'MISSING_FIELD' });

  if (!sessions.has(sessionId)) {
    return res.status(400).json({ error: 'Session not found or expired', code: 'INVALID_SESSION' });
  }

  const session = sessions.get(sessionId);

  if (!session.hasActiveError) {
    return res.status(400).json({
      error: 'No active error context for this session. Ask the student to continue writing.',
      code: 'NO_ACTIVE_ERROR'
    });
  }

  const messages = [
    { role: 'system', content: buildChatSystemPrompt(session) },
    ...session.chatHistory,
    { role: 'user', content: message }
  ];

  let reply;
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.7
    });
    reply = completion.choices[0].message.content;
  } catch (err) {
    console.error('LLM error on /chat:', err.message);
    return res.status(500).json({ error: 'LLM service unavailable', code: 'LLM_ERROR' });
  }

  // Persist chat history
  session.chatHistory.push({ role: 'user', content: message });
  session.chatHistory.push({ role: 'assistant', content: reply });

  res.json({ reply });
});

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`AI Learning Companion backend running on port ${PORT}`);
});
