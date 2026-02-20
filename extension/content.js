/********************************************************************
 * Learning Coach — Google Docs Extractor + Pause Trigger + Tooltip
 * - Works on: https://docs.google.com/document/*
 * - Extracts text via editable/accessibility DOM
 * - Shows debug overlay of extracted text
 * - Debounces (pause) before calling backend
 * - Displays hints tooltip near cursor (non-intrusive)
 ********************************************************************/

// ===================== CONFIG =====================
const BASE_URL = "http://64.181.214.188:3000";
const ANALYZE_URL = `${BASE_URL}/analyze`;
const CHAT_URL = `${BASE_URL}/chat`;
const PAUSE_MS = 1800;
const MIN_CHARS = 60;
const WINDOW_CHARS = 1200;
const COOLDOWN_MS = 8000;
const MOCK_MODE = false;

// Overlay + tooltip toggles
const SHOW_OVERLAY = true;  // set false once stable
const OVERLAY_CHARS = 1200;

// ===================== STATE =====================
let lastMouse = { x: 24, y: 24 };
let tooltip = null;
let overlay = null;

let debounceTimer = null;
let lastSentAt = 0;
let lastSentText = "";
let activeError = null; // location string when error is active, null when clean

// Track mouse so tooltip can appear near cursor
document.addEventListener(
  "mousemove",
  (e) => { lastMouse = { x: e.clientX, y: e.clientY }; },
  { passive: true }
);

// ===================== GUARDS =====================
function isGoogleDocsDoc() {
  return location.hostname === "docs.google.com" && location.pathname.startsWith("/document/");
}
if (!isGoogleDocsDoc()) {
  // Don’t run on non-doc pages.
  // (If you want broad support, remove this guard and adjust manifest matches.)
  console.log("[LC] Not a Google Docs document page; skipping.");
  // return; // can't return in top-level script in all contexts; just exit via no-ops below
}

// ===================== UI: OVERLAY =====================
function ensureOverlay() {
  if (!SHOW_OVERLAY) return null;
  let box = document.getElementById("lc-overlay");
  if (box) return box;

  box = document.createElement("div");
  box.id = "lc-overlay";
  box.style.position = "fixed";
  box.style.bottom = "12px";
  box.style.right = "12px";
  box.style.zIndex = "999999";
  box.style.width = "460px";
  box.style.maxHeight = "260px";
  box.style.overflow = "auto";
  box.style.padding = "10px";
  box.style.borderRadius = "12px";
  box.style.background = "rgba(17,17,17,0.92)";
  box.style.color = "white";
  box.style.fontSize = "12px";
  box.style.fontFamily =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  box.style.whiteSpace = "pre-wrap";
  box.textContent = "[LC overlay] Ready…";

  // Toggle collapse on click
  box.addEventListener("click", () => {
    box.style.maxHeight = (box.style.maxHeight === "34px") ? "260px" : "34px";
  });

  document.documentElement.appendChild(box);
  overlay = box;
  return box;
}

function updateOverlay(text, meta = "", newContent = null) {
  const box = ensureOverlay();
  if (!box) return;
  const preview = (text || "").slice(-OVERLAY_CHARS);
  const ncLine = newContent != null ? `\n\n── newContent (sent to API) ──\n${newContent}` : "";
  box.textContent = `[LC overlay] ${meta}\n\n── fullText (last ${OVERLAY_CHARS} chars) ──\n${preview || "(no text found yet)"}${ncLine}`;
}

// ===================== UI: TOOLTIP =====================
function ensureTooltip() {
  if (tooltip) return tooltip;

  tooltip = document.createElement("div");
  tooltip.id = "lc-tooltip";
  tooltip.style.position = "fixed";
  tooltip.style.zIndex = "999999";
  tooltip.style.maxWidth = "360px";
  tooltip.style.padding = "10px 12px";
  tooltip.style.borderRadius = "12px";
  tooltip.style.background = "white";
  tooltip.style.color = "#111";
  tooltip.style.fontSize = "13px";
  tooltip.style.lineHeight = "1.25";
  tooltip.style.boxShadow = "0 12px 30px rgba(0,0,0,0.20)";
  tooltip.style.border = "1px solid rgba(0,0,0,0.08)";
  tooltip.style.display = "none";
  tooltip.style.userSelect = "text";

  tooltip.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
      <b>Learning Coach</b>
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
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));
}

function positionTooltipNearCursor() {
  const t = ensureTooltip();
  const pad = 12;

  // offset away from pointer
  let left = lastMouse.x + 14;
  let top = lastMouse.y + 14;

  const rect = t.getBoundingClientRect();
  const maxLeft = window.innerWidth - rect.width - pad;
  const maxTop = window.innerHeight - rect.height - pad;

  left = Math.max(pad, Math.min(left, maxLeft));
  top = Math.max(pad, Math.min(top, maxTop));

  t.style.left = `${left}px`;
  t.style.top = `${top}px`;
}

function showTooltipHTML(html) {
  const t = ensureTooltip();
  t.querySelector("#lc-body").innerHTML = html;
  t.style.display = "block";
  // position after display for correct bounds
  positionTooltipNearCursor();
}

function hideTooltip() {
  if (!tooltip) return;
  tooltip.style.display = "none";
}

// ===================== EXTRACTION =====================
// Try to locate primary editor/accessible node candidates.
// Google Docs changes often; we try multiple patterns.
// function findEditableCandidates() {
//   const list = [];

//   // Common role-based candidates
//   list.push(...document.querySelectorAll('[role="textbox"]'));

//   // Contenteditable candidates
//   list.push(...document.querySelectorAll('[contenteditable="true"]'));

//   // Known containers (sometimes present)
//   const kix = document.querySelector(".kix-appview-editor");
//   if (kix) list.push(kix);

//   // Deduplicate
//   return Array.from(new Set(list));
// }

// // Pick the node with the most text (often the best accessible layer)
// function bestTextFromNodes(nodes) {
//   let best = { text: "", node: null };
//   for (const n of nodes) {
//     const text = ((n.innerText || n.textContent || "")).trim();
//     if (text.length > best.text.length) best = { text, node: n };
//   }
//   return best;
// }

// // Fallback: scan aria-label nodes and pick the best text source
// function bestTextFromAccessibleNodes() {
//   const nodes = Array.from(document.querySelectorAll("[aria-label],[aria-describedby]"));
//   return bestTextFromNodes(nodes);
// }

// function extractDocsText() {
//   const editorRoot = document.querySelector(".kix-appview-editor");

//   if (editorRoot) {
//     const text = (editorRoot.innerText || editorRoot.textContent || "").trim();
//     return { text, source: "kix_editor_root" };
//   }

//   // fallback if selector fails (rare)
//   const bodyText = (document.body?.innerText || "").trim();
//   return { text: bodyText, source: "body_fallback" };
// }

//OLD VERSION Main extraction
// function extractDocsText() {
//   // 1) Try editable candidates
//   const editable = findEditableCandidates();
//   const bestEditable = bestTextFromNodes(editable);
//   if (bestEditable.text.length > 80) {
//     return { text: bestEditable.text, source: "editable_best" };
//   }

//   // 2) Try broader accessible nodes
//   const bestA11y = bestTextFromAccessibleNodes();
//   if (bestA11y.text.length > 80) {
//     return { text: bestA11y.text, source: "a11y_best" };
//   }

//   // 3) Last-resort: whole body (noisy)
//   const bodyText = (document.body?.innerText || "").trim();
//   if (bodyText.length > 200) {
//     return { text: bodyText, source: "body_fallback" };
//   }

//   return { text: "", source: "none" };
// }
function extractDocsText() {
  // .kix-paragraphrenderer elements contain only actual document paragraphs —
  // no UI chrome, image captions, suggestion labels, or toolbar hints.
  const paras = document.querySelectorAll(".kix-paragraphrenderer");
  if (paras.length > 0) {
    const text = Array.from(paras)
      .map(p => (p.innerText || p.textContent || "").trim())
      .filter(t => t.length > 0)
      .join("\n");
    if (text.length > 10) return { text, source: "kix_paragraphrenderer" };
  }

  // Fallback: broader editor root (includes some UI labels — less precise)
  const editorRoot = document.querySelector(".kix-appview-editor");
  if (editorRoot) {
    const text = (editorRoot.innerText || editorRoot.textContent || "").trim();
    return { text, source: "kix_editor_root" };
  }

  // Last resort
  const bodyText = (document.body?.innerText || "").trim();
  return { text: bodyText, source: "body_fallback" };
}


// ===================== DETECTION (cheap local) =====================
function localDetectFlag(text) {
  const t = text.toLowerCase();

  const absolutes = /\b(always|never|obviously|clearly|proves)\b/;
  const claim = /\b(therefore|this shows|this proves|thus)\b/;
  const support = /\b(because|for example|for instance|data|evidence|citation|according to)\b/;

  if (absolutes.test(t)) return "Strong/absolute claim language";
  if (claim.test(t) && !support.test(t)) return "Claim may need evidence";

  const lastSentence = text.split(/[.!?]/).slice(-2, -1)[0] || text;
  const wc = lastSentence.trim().split(/\s+/).filter(Boolean).length;
  if (wc > 35) return "Long sentence (clarity risk)";

  return null;
}

// ===================== BACKEND CALL =====================

function detectSubject(text) {
  const mathPattern = /[=+\-*/^√∫Σπ]|(\d+\s*[+\-*/]\s*\d+)/;
  const sentencePattern = /[a-zA-Z]{4,}\s+[a-zA-Z]{4,}/;

  if (mathPattern.test(text)) return "math";
  if (sentencePattern.test(text)) return "writing";
  return "unknown";
}

function mapSubjectToContract(text) {
  const detected = detectSubject(text);
  if (detected === "math") return "math";
  if (detected === "writing") return "writing";
  return "other";
}

// Extract the last completed sentence/line — this becomes newContent for the API.
// A "completed" sentence ends with . ? ! or a newline.
// We prefer the last completed chunk; fall back to the full tail if nothing qualifies.
function extractNewContent(fullText) {
  const text = (fullText || '').trim();

  // Split on sentence-ending punctuation followed by whitespace, OR on blank lines
  // Keep the delimiter attached to the chunk that precedes it so we see "sentence."
  const chunks = text.split(/(?<=[.?!\n])\s+/).map(s => s.trim()).filter(s => s.length > 5);

  // Find the last chunk that actually ends with a sentence terminator (completed chunk)
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (/[.?!\n]$/.test(chunks[i])) {
      return chunks[i];
    }
  }

  // Nothing ends with punctuation — user hasn't finished a sentence yet.
  // Return the last chunk so the AI can still check partial work.
  return chunks[chunks.length - 1] || text.slice(-300);
}

// Session management via chrome.storage.local
async function getSessionId() {
  return new Promise(resolve =>
    chrome.storage.local.get('sessionId', r => resolve(r.sessionId || null))
  );
}

async function saveSessionId(id) {
  return new Promise(resolve => chrome.storage.local.set({ sessionId: id }, resolve));
}

async function getSubject() {
  return new Promise(resolve =>
    chrome.storage.local.get('subject', r => resolve(r.subject || null))
  );
}

async function callAnalyzeAPI(fullText, newContent) {
  if (MOCK_MODE) {
    await new Promise(r => setTimeout(r, 500));
    const subject = mapSubjectToContract(newContent);
    if (subject === "math") {
      return { sessionId: "mock-session-001", hasError: true, location: "In your most recent step." };
    }
    if (subject === "writing") {
      return { sessionId: "mock-session-001", hasError: true, location: "In your most recent sentence." };
    }
    return { sessionId: "mock-session-001", hasError: false };
  }

  const sessionId = await getSessionId();
  const storedSubject = await getSubject();
  const subject = storedSubject || mapSubjectToContract(newContent);

  // Route through background service worker to avoid mixed-content block
  // (Google Docs is HTTPS; our backend is HTTP)
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
  // If an error is active, keep the tooltip visible with a subtle "re-checking" hint
  // so the student knows the issue hasn't been cleared yet.
  // Only hide when there's no active error (idle / looking good state).
  if (activeError) {
    showTooltipHTML(`
      <div style="color:#b45309;font-weight:bold;">⚠️ Issue still present</div>
      <div style="margin-top:8px;color:#555;font-size:12px;">Re-checking as you edit… pause to get an updated result.</div>
    `);
  } else {
    hideTooltip();
  }
  scheduleAnalyze();
}

async function analyzeNow() {
  const { text, source } = extractDocsText();
  console.log(`[Rethink] analyzeNow fired | source=${source} | len=${text.length}`);

  const trimmed = (text || "").trim();
  if (trimmed.length < MIN_CHARS) {
    console.log(`[Rethink] Too short (${trimmed.length} < ${MIN_CHARS}), skipping`);
    showTooltipHTML(`
      <div><b>Rethink</b></div>
      <div style="margin-top:8px;color:#555;">Keep going—pause again after you write a bit more.</div>
    `);
    return;
  }

  const fullText = trimmed.slice(-WINDOW_CHARS);
  const newContent = extractNewContent(fullText);
  updateOverlay(fullText, `source=${source} | len=${text.length}`, newContent);
  console.log(`[Rethink] newContent →`, newContent);

  // Cooldown + duplicate suppression
  const now = Date.now();
  const coolingDown = (now - lastSentAt < COOLDOWN_MS);
  const duplicate = (newContent === lastSentText);
  console.log(`[Rethink] coolingDown=${coolingDown} duplicate=${duplicate} activeError=${activeError}`);

  if (coolingDown || duplicate) {
    // Re-show the active error during cooldown so it never disappears on the student
    if (activeError) {
      showTooltipHTML(`
        <div style="color:#b45309;font-weight:bold;">⚠️ Potential issue found</div>
        <div style="margin-top:10px;color:#333;"><b>Where to look:</b> ${escapeHtml(activeError)}</div>
        <div style="margin-top:10px;font-size:12px;color:#666;">Open the Rethink popup to get a guided hint.</div>
        <div style="margin-top:10px;font-size:12px;color:#666;">Keep editing and pause to re-check.</div>
      `);
    } else {
      showTooltipHTML(`
        <div style="color:#2563eb;">✅ Ready</div>
        <div style="margin-top:8px;color:#666;font-size:12px;">
          ${coolingDown ? "Cooling down—pause again in a few seconds." : "No changes since last check."}
        </div>
      `);
    }
    return;
  }

  // Only show "analyzing" flash when we're actually making an API call
  showTooltipHTML(`
    <div style="color:#2563eb;">🔍 Analyzing…</div>
    <div style="margin-top:8px;color:#555;">Checking your work…</div>
  `);

  lastSentAt = now;
  lastSentText = newContent;

  try {
    console.log(`[Rethink] → POST /analyze | subject=${await getSubject() || mapSubjectToContract(newContent)}`);
    const out = await callAnalyzeAPI(fullText, newContent);
    console.log(`[Rethink] ← /analyze response:`, out);

    if (out.hasError) {
      activeError = out.location || "In your recent work.";
      showTooltipHTML(`
        <div style="color:#b45309;font-weight:bold;">⚠️ Potential issue found</div>
        <div style="margin-top:10px;color:#333;"><b>Where to look:</b> ${escapeHtml(activeError)}</div>
        <div style="margin-top:10px;font-size:12px;color:#666;">Open the Rethink popup to get a guided hint.</div>
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
// Google Docs typing is complex; "input" may not fire reliably.
// We listen broadly: keydown + keyup + selectionchange, plus MutationObserver.

document.addEventListener("keydown", (e) => {
  if (!isGoogleDocsDoc()) return;
  // Only schedule on likely typing keys; still okay to be broad for hackathon
  onTypingEvent();
}, true);

document.addEventListener("keyup", (e) => {
  if (!isGoogleDocsDoc()) return;
  onTypingEvent();
}, true);

// Pre-create tooltip and overlay before the MutationObserver starts watching,
// so their initial appendChild calls don't trigger scheduleAnalyze().
if (SHOW_OVERLAY) ensureOverlay();
ensureTooltip();

// Docs updates often show up as DOM mutations rather than input events.
// Filter out mutations caused by our own tooltip/overlay so they don't
// re-trigger analysis and overwrite the result immediately.
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

// Update overlay with initial text (elements already created above)
if (SHOW_OVERLAY) {
  const { text, source } = extractDocsText();
  updateOverlay(text, `init source=${source} | len=${text.length}`);
}

console.log("[LC] Google Docs extractor loaded.");
