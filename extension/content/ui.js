// content/ui.js — Rethink AI
// All UI elements: debug overlay and in-page tooltip.
// Depends on: config.js, state.js

// ── Debug Overlay ──────────────────────────────────────────────────────────

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

// ── Tooltip ────────────────────────────────────────────────────────────────

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