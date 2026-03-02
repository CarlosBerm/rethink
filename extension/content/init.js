// content/init.js — Rethink AI
// Entry point: guard, event listeners, and MutationObserver setup.
// Must be loaded last (depends on all other content/ files).

// ── Guard ─────────────────────────────────────────────────────────────────

function isGoogleDocsDoc() {
  return location.hostname === "docs.google.com" &&
         location.pathname.startsWith("/document/");
}

// ── Mouse tracking (for tooltip positioning) ──────────────────────────────

document.addEventListener("mousemove", (e) => {
  lastMouse = { x: e.clientX, y: e.clientY };
}, { passive: true });

// ── Pre-create UI elements ────────────────────────────────────────────────
// Done before MutationObserver starts to prevent self-triggering.

if (SHOW_OVERLAY) ensureOverlay();
ensureTooltip();

// ── Keyboard listener ─────────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  if (!isGoogleDocsDoc()) return;

  // Build keyboard buffer for fallback text extraction (pre-first-save)
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

// ── MutationObserver ──────────────────────────────────────────────────────
// Fires when Google Docs updates the DOM (e.g. after paste).
// Filters out mutations caused by our own tooltip/overlay elements.

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
