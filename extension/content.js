/********************************************************************
 * Learning Coach — Google Docs Extractor + Pause Trigger + Tooltip
 * - Works on: https://docs.google.com/document/*
 * - Extracts text via editable/accessibility DOM
 * - Shows debug overlay of extracted text
 * - Debounces (pause) before calling backend
 * - Displays hints tooltip near cursor (non-intrusive)
 ********************************************************************/

// ===================== CONFIG =====================
const API_URL = "http://localhost:8000/analyze"; // change to /coach if needed
const PAUSE_MS = 1800;
const MIN_CHARS = 60;
const WINDOW_CHARS = 1200;
const COOLDOWN_MS = 8000;

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

function updateOverlay(text, meta = "") {
  const box = ensureOverlay();
  if (!box) return;
  const preview = (text || "").slice(-OVERLAY_CHARS);
  box.textContent = `[LC overlay] ${meta}\n\n${preview || "(no text found yet)"}`;
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
function findEditableCandidates() {
  const list = [];

  // Common role-based candidates
  list.push(...document.querySelectorAll('[role="textbox"]'));

  // Contenteditable candidates
  list.push(...document.querySelectorAll('[contenteditable="true"]'));

  // Known containers (sometimes present)
  const kix = document.querySelector(".kix-appview-editor");
  if (kix) list.push(kix);

  // Deduplicate
  return Array.from(new Set(list));
}

// Pick the node with the most text (often the best accessible layer)
function bestTextFromNodes(nodes) {
  let best = { text: "", node: null };
  for (const n of nodes) {
    const text = ((n.innerText || n.textContent || "")).trim();
    if (text.length > best.text.length) best = { text, node: n };
  }
  return best;
}

// Fallback: scan aria-label nodes and pick the best text source
function bestTextFromAccessibleNodes() {
  const nodes = Array.from(document.querySelectorAll("[aria-label],[aria-describedby]"));
  return bestTextFromNodes(nodes);
}

// Main extraction
function extractDocsText() {
  // 1) Try editable candidates
  const editable = findEditableCandidates();
  const bestEditable = bestTextFromNodes(editable);
  if (bestEditable.text.length > 80) {
    return { text: bestEditable.text, source: "editable_best" };
  }

  // 2) Try broader accessible nodes
  const bestA11y = bestTextFromAccessibleNodes();
  if (bestA11y.text.length > 80) {
    return { text: bestA11y.text, source: "a11y_best" };
  }

  // 3) Last-resort: whole body (noisy)
  const bodyText = (document.body?.innerText || "").trim();
  if (bodyText.length > 200) {
    return { text: bodyText, source: "body_fallback" };
  }

  return { text: "", source: "none" };
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
async function callAnalyzeAPI(text) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      url: location.href,
      // subject: "auto", // optionally add
      // sessionId: "..."  // optionally add
    })
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${msg}`);
  }
  return res.json();
}

// ===================== PAUSE TRIGGER =====================
function scheduleAnalyze() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(analyzeNow, PAUSE_MS);
}

function onTypingEvent() {
  // Hide tooltip while typing (feels natural)
  hideTooltip();
  scheduleAnalyze();
}

async function analyzeNow() {
  const { text, source } = extractDocsText();
  updateOverlay(text, `source=${source} | len=${text.length}`);

  const trimmed = (text || "").trim();
  if (trimmed.length < MIN_CHARS) return;

  const windowed = trimmed.slice(-WINDOW_CHARS);
  const flag = localDetectFlag(windowed);
  if (!flag) return; // no intervention if nothing notable

  const now = Date.now();
  if (now - lastSentAt < COOLDOWN_MS) {
    // still show quick local flag to feel realtime
    showTooltipHTML(`
      <div style="color:#b45309;">⚠️ ${escapeHtml(flag)}</div>
      <div style="margin-top:8px;color:#666;font-size:12px;">(Cooling down… pause again in a few seconds)</div>
    `);
    return;
  }
  if (windowed === lastSentText) return;

  lastSentAt = now;
  lastSentText = windowed;

  // Local immediate tooltip
  showTooltipHTML(`
    <div style="color:#b45309;">⚠️ ${escapeHtml(flag)}</div>
    <div style="margin-top:8px;color:#555;">Thinking of hints…</div>
    <div style="margin-top:8px;font-size:12px;color:#666;">(Hints-only • no full answers)</div>
  `);

  try {
    const out = await callAnalyzeAPI(windowed);

    // Support both /analyze and /coach-style responses
    const why = out.why || out.nudge || out.reason || "—";
    const hints = (out.hints || []).slice(0, 3).map(h => `<li>${escapeHtml(h)}</li>`).join("");
    const q = out.reflection_question || out.question || "—";

    showTooltipHTML(`
      <div style="color:#b45309;">⚠️ ${escapeHtml(flag)}</div>
      <div style="margin-top:10px;"><b>Why:</b> ${escapeHtml(why)}</div>
      <div style="margin-top:10px;"><b>Hints:</b><ul style="margin:6px 0 0 18px;">${hints || "<li>—</li>"}</ul></div>
      <div style="margin-top:10px;"><b>Question:</b> ${escapeHtml(q)}</div>
      <div style="margin-top:10px;font-size:12px;color:#666;">Pause after edits to re-check.</div>
    `);
  } catch (e) {
    showTooltipHTML(`
      <div style="color:#b45309;">⚠️ ${escapeHtml(flag)}</div>
      <div style="margin-top:10px;"><b>Backend error</b></div>
      <div style="margin-top:6px;color:#555;">${escapeHtml(e.message || String(e))}</div>
      <div style="margin-top:6px;color:#666;font-size:12px;">Check API_URL and that the server is running.</div>
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

// Docs updates often show up as DOM mutations rather than input events
const obs = new MutationObserver(() => {
  if (!isGoogleDocsDoc()) return;
  // schedule analysis on any mutation (debounced)
  scheduleAnalyze();
});
obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true });

// Initial overlay
if (SHOW_OVERLAY) {
  ensureOverlay();
  const { text, source } = extractDocsText();
  updateOverlay(text, `init source=${source} | len=${text.length}`);
}

console.log("[LC] Google Docs extractor loaded.");
