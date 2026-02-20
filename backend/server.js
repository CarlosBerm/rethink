const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const common = require('oci-common');
const aiinference = require('oci-generativeaiinference');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const GENAI_ENDPOINT = 'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com';
const MODEL_ID = 'meta.llama-3.3-70b-instruct';

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

// ---- OCI GenAI client ----
let genaiClient;
let compartmentId;

async function initOCI() {
  // Fetch compartment ID from instance metadata (no env var needed)
  const metaRes = await fetch('http://169.254.169.254/opc/v2/instance/', {
    headers: { Authorization: 'Bearer Oracle' }
  });
  const meta = await metaRes.json();
  compartmentId = process.env.OCI_COMPARTMENT_ID || meta.compartmentId;

  // Instance principal auth — the OCI instance IS the credential
  const provider = await new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
  genaiClient = new aiinference.GenerativeAiInferenceClient({
    authenticationDetailsProvider: provider
  });
  genaiClient.endpoint = GENAI_ENDPOINT;

  console.log(`OCI GenAI client initialized | compartment: ${compartmentId}`);
}

// ---- LLM helper ----

function toOciMessages(messages) {
  return messages.map(m => ({
    role: m.role === 'assistant' ? 'CHATBOT' : m.role.toUpperCase(),
    content: [{ type: 'TEXT', text: m.content }]
  }));
}

function extractJson(text) {
  // Try direct parse, then strip markdown code fences
  try { return JSON.parse(text); } catch {}
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*?\})/);
  if (match) return JSON.parse(match[1].trim());
  throw new Error('Could not parse JSON from LLM response: ' + text);
}

async function callLLM(messages, temperature = 0.7) {
  const response = await genaiClient.chat({
    chatDetails: {
      compartmentId,
      servingMode: {
        modelId: MODEL_ID,
        servingType: 'ON_DEMAND'
      },
      chatRequest: {
        apiFormat: 'GENERIC',
        messages: toOciMessages(messages),
        maxTokens: 1024,
        temperature,
        isStream: false
      }
    }
  });
  return response.chatResult.chatResponse.choices[0].message.content[0].text;
}

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

Respond ONLY with valid JSON — no other text, no markdown, no explanation.

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
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// POST /analyze
app.post('/analyze', async (req, res) => {
  const { sessionId, subject, fullText, newContent } = req.body;

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
    const raw = await callLLM([
      { role: 'system', content: buildAnalyzeSystemPrompt(subject) },
      { role: 'user', content: `Full text:\n"""\n${fullText}\n"""\n\nNewly completed content to analyze:\n"""\n${newContent}\n"""` }
    ], 0.2);
    llmResult = extractJson(raw);
  } catch (err) {
    console.error('LLM error on /analyze:', err.message);
    return res.status(500).json({ error: 'LLM service unavailable', code: 'LLM_ERROR' });
  }

  if (llmResult.hasError) {
    session.errorInternal = llmResult.internalError;
    session.errorLocation = llmResult.location;
    session.hasActiveError = true;
    session.chatHistory = [];
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
    reply = await callLLM(messages, 0.7);
  } catch (err) {
    console.error('LLM error on /chat:', err.message);
    return res.status(500).json({ error: 'LLM service unavailable', code: 'LLM_ERROR' });
  }

  session.chatHistory.push({ role: 'user', content: message });
  session.chatHistory.push({ role: 'assistant', content: reply });

  res.json({ reply });
});

// ---- Start ----
initOCI()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`AI Learning Companion backend running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize OCI client:', err.message);
    process.exit(1);
  });
