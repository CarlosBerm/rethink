// content/analyzer.js — Rethink AI
// Core analysis loop: debounce → fetch text → call API → show result.
// Depends on: config.js, state.js, ui.js, text-extraction.js, api.js

// ── Debounce trigger ──────────────────────────────────────────────────────

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

// ── Main analysis function ────────────────────────────────────────────────

async function analyzeNow() {
  // Respect the popup's on/off toggle
  const enabled = await new Promise(r =>
    chrome.storage.local.get("enabled", d => r(d.enabled !== false))
  );
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
  lastFullText = fullText;   // update snapshot for next diff
  updateOverlay(fullText, newContent, source);
  console.log(`[Rethink] newContent →`, newContent);

  const now         = Date.now();
  const coolingDown = now - lastSentAt < COOLDOWN_MS;
  const duplicate   = newContent === lastSentText;
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

    // Persist result so popup status banner can reflect it
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