/********************************************************************
 * Rethink AI — Google Docs content script
 * Text extraction: Google Docs /export?format=txt endpoint
 *   (same-origin fetch — works with the user's existing auth cookies)
 * Fallback: keyboard buffer (captures unsaved characters typed this session)
 ********************************************************************/

// ===================== CONFIG =====================
const BASE_URL    = "http://64.181.214.188:3000";
const PAUSE_MS    = 1800;   // ms of silence before checking
const MIN_CHARS   = 40;     // minimum text length before calling API
const WINDOW_CHARS = 1200;  // max characters sent to backend
const COOLDOWN_MS = 8000;   // ms between API calls
const SHOW_OVERLAY = true;  // debug overlay — set false for demo

// ===================== STATE =====================
let lastMouse     = { x: 24, y: 24 };
let tooltip       = null;
let overlay       = null;
let debounceTimer = null;
let lastSentAt    = 0;
let lastSentText  = "";
let activeError   = null;

// Keyboard buffer — captures characters typed this session
// Used as fallback when export isn't ready yet (new blank doc, no saves yet)
let typedBuffer = "";

// Export cache — avoid hammering the export endpoint on every keystroke
let _exportCache  = { text: "", ts: 0 };
const EXPORT_TTL  = 5000; // re-fetch at most once every 5 s

document.addEventListener("mousemove", (e) => {
  lastMouse = { x: e.clientX, y: e.clientY };
}, { passive: true });

// ===================== GUARDS =====================
function isGoogleDocsDoc() {
  return location.hostname === "docs.google.com" &&
         location.pathname.startsWith("/document/");
}

// ===================== UI: OVERLAY =====================
function ensureOverlay() {
  if (!SHOW_OVERLAY) return null;
  let box = document.getElementById("lc-overlay");
  if (box) return box;

  box = document.createElement("div");
  box.id = "lc-overlay";
  Object.assign(box.style, {
    position: "fixed", bottom: "12px", right: "12px", zIndex: "999999",
    width: "460px", maxHeight: "260px", overflow: "auto", padding: "10px",
    borderRadius: "12px", background: "rgba(17,17,17,0.92)", color: "white",
    fontSize: "12px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    whiteSpace: "pre-wrap",
  });
  box.textContent = "[Rethink] Ready…";
  box.addEventListener("click", () => {
    box.style.maxHeight = box.style.maxHeight === "34px" ? "260px" : "34px";
  });
  document.documentElement.appendChild(box);
  overlay = box;
  return box;
}

function updateOverlay(fullText, newContent, source) {
  const box = ensureOverlay();
  if (!box) return;
  const preview = (fullText || "").slice(-600);
  box.textContent =
    `[Rethink] source=${source}\n\n` +
    `── fullText ──\n${preview || "(empty)"}\n\n` +
    `── newContent (sent to API) ──\n${newContent || "(empty)"}`;
}

// ===================== UI: TOOLTIP =====================
function ensureTooltip() {
  if (tooltip) return tooltip;

  tooltip = document.createElement("div");
  tooltip.id = "lc-tooltip";
  Object.assign(tooltip.style, {
    position: "fixed", zIndex: "999999", maxWidth: "360px",
    padding: "10px 12px", borderRadius: "12px", background: "white",
    color: "#111", fontSize: "13px", lineHeight: "1.25",
    boxShadow: "0 12px 30px rgba(0,0,0,0.20)", border: "1px solid rgba(0,0,0,0.08)",
    display: "none", userSelect: "text",
  });
  tooltip.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
      <b>Rethink</b>
      <button id="lc-x" style="border:none;background:#eee;border-radius:10px;padding:2px 8px;cursor:pointer;">x</button>
    </div>
    <div id="lc-body" style="margin-top:8px;">…</div>
  `;
  tooltip.addEventListener("click", (e) => e.stopPropagation());
  tooltip.querySelector("#lc-x").addEventListener("click", () => hideTooltip());
  document.documentElement.appendChild(tooltip);
  document.addEventListener("mousedown", () => hideTooltip(), true);
  return tooltip;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c])
  );
}

function positionTooltipNearCursor() {
  const t = ensureTooltip();
  const pad = 12;
  let left = lastMouse.x + 14;
  let top  = lastMouse.y + 14;
  const rect = t.getBoundingClientRect();
  left = Math.max(pad, Math.min(left, window.innerWidth  - rect.width  - pad));
  top  = Math.max(pad, Math.min(top,  window.innerHeight - rect.height - pad));
  t.style.left = `${left}px`;
  t.style.top  = `${top}px`;
}

function showTooltipHTML(html) {
  const t = ensureTooltip();
  t.querySelector("#lc-body").innerHTML = html;
  t.style.display = "block";
  positionTooltipNearCursor();
}

function hideTooltip() {
  if (tooltip) tooltip.style.display = "none";
}

// ===================== TEXT EXTRACTION =====================
// Strategy 1: Fetch the document's plain-text export.
//   Same-origin request from the content script — uses the user's Google session cookies.
//   Returns the full saved document text.
// Strategy 2: Keyboard buffer — typed characters accumulated this session.
//   Fills the gap between page load and the first auto-save.

async function fetchDocumentText() {
  const docId = location.pathname.match(/\/document\/d\/([^/]+)/)?.[1];
  if (!docId) return "";

  // Use cached value if still fresh
  if (Date.now() - _exportCache.ts < EXPORT_TTL && _exportCache.text) {
    return _exportCache.text;
  }

  try {
    const res = await fetch(
      `https://docs.google.com/document/d/${docId}/export?format=txt`,
      { credentials: "same-origin" }
    );
    if (!res.ok) {
      console.log(`[Rethink] Export returned ${res.status}`);
      return _exportCache.text;
    }
    const raw = await res.text();
    _exportCache = { text: raw.trim(), ts: Date.now() };
    console.log(`[Rethink] Export OK — ${_exportCache.text.length} chars`);
    return _exportCache.text;
  } catch (e) {
    console.log("[Rethink] Export fetch error:", e.message);
    return _exportCache.text;
  }
}

async function getDocumentText() {
  const exported = await fetchDocumentText();

  // If we have a healthy export, use it (it's complete and reliable)
  if (exported.length >= MIN_CHARS) {
    return { text: exported, source: "export" };
  }

  // Fall back to keyboard buffer (new/blank doc, or export not ready yet)
  if (typedBuffer.length > 0) {
    return { text: typedBuffer, source: "keyboard" };
  }

  return { text: "", source: "none" };
}

// ===================== LAST SENTENCE EXTRACTION =====================
// Sends only the most recently completed sentence to the API ("newContent").
function extractNewContent(fullText) {
  const text = (fullText || "").trim();
  const chunks = text.split(/(?<=[.?!\n])\s+/).map(s => s.trim()).filter(s => s.length > 5);
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (/[.?!\n]$/.test(chunks[i])) return chunks[i];
  }
  return chunks[chunks.length - 1] || text.slice(-300);
}

// ===================== BACKEND CALL =====================
function detectSubject(text) {
  if (/[=+\-*/^√∫Σπ]|(\d+\s*[+\-*/]\s*\d+)/.test(text)) return "math";
  if (/[a-zA-Z]{4,}\s+[a-zA-Z]{4,}/.test(text)) return "writing";
  return "other";
}

async function getSessionId() {
  return new Promise(r => chrome.storage.local.get("sessionId", d => r(d.sessionId || null)));
}
async function saveSessionId(id) {
  return new Promise(r => chrome.storage.local.set({ sessionId: id }, r));
}
async function getSubject() {
  return new Promise(r => chrome.storage.local.get("subject", d => r(d.subject || null)));
}

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

// ===================== PAUSE TRIGGER =====================
function scheduleAnalyze() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(analyzeNow, PAUSE_MS);
}

function onTypingEvent() {
  if (activeError) {
    showTooltipHTML(`
      <div style="color:#b45309;font-weight:bold;">⚠️ Issue still present</div>
      <div style="margin-top:8px;color:#555;font-size:12px;">Re-checking as you edit…</div>
    `);
  } else {
    hideTooltip();
  }
  scheduleAnalyze();
}

async function analyzeNow() {
  // Check if user has disabled Rethink via popup toggle
  const enabled = await new Promise(r => chrome.storage.local.get("enabled", d => r(d.enabled !== false)));
  if (!enabled) return;

  const { text, source } = await getDocumentText();
  const trimmed = text.trim();

  console.log(`[Rethink] analyzeNow | source=${source} | len=${trimmed.length}`);

  if (trimmed.length < MIN_CHARS) {
    showTooltipHTML(`
      <div><b>Rethink</b></div>
      <div style="margin-top:8px;color:#555;">Keep writing — Rethink will check once you have more content.</div>
    `);
    return;
  }

  const fullText   = trimmed.slice(-WINDOW_CHARS);
  const newContent = extractNewContent(fullText);
  updateOverlay(fullText, newContent, source);
  console.log(`[Rethink] newContent →`, newContent);

  const now        = Date.now();
  const coolingDown = now - lastSentAt < COOLDOWN_MS;
  const duplicate  = newContent === lastSentText;
  console.log(`[Rethink] coolingDown=${coolingDown} duplicate=${duplicate} activeError=${activeError}`);

  if (coolingDown || duplicate) {
    if (activeError) {
      showTooltipHTML(`
        <div style="color:#b45309;font-weight:bold;">⚠️ Potential issue found</div>
        <div style="margin-top:10px;color:#333;"><b>Where to look:</b> ${escapeHtml(activeError)}</div>
        <div style="margin-top:10px;font-size:12px;color:#666;">Keep editing and pause to re-check.</div>
      `);
    }
    return;
  }

  showTooltipHTML(`<div style="color:#2563eb;">🔍 Analyzing…</div>`);
  lastSentAt   = now;
  lastSentText = newContent;

  try {
    console.log(`[Rethink] → POST /analyze | subject=${detectSubject(newContent)}`);
    const out = await callAnalyzeAPI(fullText, newContent);
    console.log(`[Rethink] ← /analyze response:`, out);

    // Save result for popup to display
    chrome.storage.local.set({ lastResult: { hasError: out.hasError, location: out.location || null } });

    if (out.hasError) {
      activeError = out.location || "In your recent work.";
      showTooltipHTML(`
        <div style="color:#b45309;font-weight:bold;">⚠️ Potential issue found</div>
        <div style="margin-top:10px;color:#333;"><b>Where to look:</b> ${escapeHtml(activeError)}</div>
        <div style="margin-top:10px;font-size:12px;color:#666;">Open the Rethink popup for a guided hint.</div>
        <div style="margin-top:10px;font-size:12px;color:#666;">Keep editing and pause to re-check.</div>
      `);
    } else {
      activeError = null;
      showTooltipHTML(`
        <div style="color:#16a34a;font-weight:bold;">✅ Looking good!</div>
        <div style="margin-top:8px;color:#555;">No issues detected. Keep writing.</div>
      `);
    }
  } catch (e) {
    showTooltipHTML(`
      <div style="color:#b45309;">⚠️ Rethink error</div>
      <div style="margin-top:6px;color:#555;">${escapeHtml(e.message || String(e))}</div>
    `);
  }
}

// ===================== EVENT HOOKS =====================
// Pre-create UI elements before MutationObserver starts (prevents self-triggering)
if (SHOW_OVERLAY) ensureOverlay();
ensureTooltip();

document.addEventListener("keydown", (e) => {
  if (!isGoogleDocsDoc()) return;
  // Build keyboard buffer for fallback text extraction
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    if      (e.key === "Backspace") typedBuffer = typedBuffer.slice(0, -1);
    else if (e.key === "Enter")     typedBuffer += "\n";
    else if (e.key.length === 1)    typedBuffer += e.key;
  }
  onTypingEvent();
}, true);

document.addEventListener("keyup", () => {
  if (!isGoogleDocsDoc()) return;
  onTypingEvent();
}, true);

// MutationObserver — fires when Google Docs updates the DOM (e.g. after paste)
const obs = new MutationObserver((mutations) => {
  if (!isGoogleDocsDoc()) return;
  const ours = mutations.every(m =>
    (tooltip && (tooltip === m.target || tooltip.contains(m.target))) ||
    (overlay && (overlay === m.target || overlay.contains(m.target)))
  );
  if (ours) return;
  scheduleAnalyze();
});
obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true });

console.log("[Rethink] Loaded — using export endpoint for text extraction.");
