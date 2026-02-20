// content/text-extraction.js — Rethink AI
// Extracts the document text via the Google Docs /export endpoint.
// Falls back to the keyboard buffer for unsaved new documents.
// Depends on: config.js, state.js

// ── Primary: Google Docs export endpoint ──────────────────────────────────
// Same-origin fetch from content script context — uses the user's existing
// Google session cookies. Returns full saved document text.

async function fetchDocumentText() {
  const docId = location.pathname.match(/\/document\/d\/([^/]+)/)?.[1];
  if (!docId) return "";

  // Return cached value if still fresh
  if (Date.now() - _exportCache.ts < EXPORT_TTL && _exportCache.text) {
    return _exportCache.text;
  }

  try {
    const res = await fetch(
      `https://docs.google.com/document/d/${docId}/export?format=txt`,
      { credentials: "same-origin" }  // sends cookies to docs.google.com only
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

// ── Fallback: keyboard buffer ─────────────────────────────────────────────

async function getDocumentText() {
  const exported = await fetchDocumentText();

  // Use export if healthy — it's complete and reliable
  if (exported.length >= MIN_CHARS) {
    return { text: exported, source: "export" };
  }

  // Fall back to keyboard buffer (new/blank doc, or export not ready yet)
  if (typedBuffer.length > 0) {
    return { text: typedBuffer, source: "keyboard" };
  }

  return { text: "", source: "none" };
}

// ── Sentence extraction ───────────────────────────────────────────────────
// Returns the sentence that changed since the last analysis cycle.
// Falls back to the last complete sentence when no diff is found.

function extractNewContent(fullText) {
  const text = (fullText || "").trim();
  const sentences = text.split(/(?<=[.?!\n])\s+/).map(s => s.trim()).filter(s => s.length > 5);

  // Diff against the previous snapshot to find which sentence was edited or added.
  if (lastFullText) {
    const oldSet = new Set(
      lastFullText.trim().split(/(?<=[.?!\n])\s+/).map(s => s.trim()).filter(s => s.length > 5)
    );
    const changed = sentences.find(s => /[.?!\n]$/.test(s) && !oldSet.has(s));
    if (changed) return changed;
  }

  // Fallback: return the last complete sentence (original behaviour).
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (/[.?!\n]$/.test(sentences[i])) return sentences[i];
  }
  return sentences[sentences.length - 1] || text.slice(-300);
}
