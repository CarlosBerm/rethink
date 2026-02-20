// content/api.js — Rethink AI
// Storage helpers and backend communication via the background service worker.
// Depends on: config.js

// ── Subject detection ─────────────────────────────────────────────────────

function detectSubject(text) {
  if (/[=+\-*/^√∫Σπ]|(\d+\s*[+\-*/]\s*\d+)/.test(text)) return "math";
  if (/[a-zA-Z]{4,}\s+[a-zA-Z]{4,}/.test(text)) return "writing";
  return "other";
}

// ── chrome.storage helpers ────────────────────────────────────────────────

async function getSessionId() {
  return new Promise(r => chrome.storage.local.get("sessionId", d => r(d.sessionId || null)));
}

async function saveSessionId(id) {
  return new Promise(r => chrome.storage.local.set({ sessionId: id }, r));
}

async function getSubject() {
  return new Promise(r => chrome.storage.local.get("subject", d => r(d.subject || null)));
}

// ── Backend call ──────────────────────────────────────────────────────────
// Sends the request through background.js to avoid mixed-content blocks
// (Google Docs is HTTPS; our backend is HTTP).

async function callAnalyzeAPI(fullText, newContent) {
  const sessionId = await getSessionId();
  const subject   = (await getSubject()) || detectSubject(newContent);

  const response = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "ANALYZE", payload: { sessionId, subject, fullText, newContent } },
      (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res.ok) return reject(new Error(res.error));
        resolve(res.data);
      }
    );
  });

  if (response.sessionId) await saveSessionId(response.sessionId);
  return response;
}
