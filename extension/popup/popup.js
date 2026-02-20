// popup.js — Rethink AI popup

// ── Storage helpers ───────────────────────────────────────────────────────
function storageGet(keys) {
  return new Promise(r => chrome.storage.local.get(keys, r));
}
function storageSet(obj) {
  return new Promise(r => chrome.storage.local.set(obj, r));
}

// ── DOM refs ──────────────────────────────────────────────────────────────
const toggleEl     = document.getElementById("enabled-toggle");
const toggleLabel  = document.getElementById("toggle-label");
const pills        = document.querySelectorAll(".pill");
const chatLog      = document.getElementById("chat-log");
const chatInput    = document.getElementById("chat-input");
const chatSend     = document.getElementById("chat-send");
const statusBanner = document.getElementById("status-banner");

// ── Init: load saved settings ─────────────────────────────────────────────
async function init() {
  const data = await storageGet(["enabled", "subject", "sessionId", "lastResult"]);

  // Restore toggle state (default on)
  const isEnabled = data.enabled !== false;
  toggleEl.checked = isEnabled;
  updateToggleLabel(isEnabled);

  // Restore active subject pill
  if (data.subject) {
    pills.forEach(p => setActivePill(p, p.dataset.subject === data.subject));
  }

  // Show last analysis result if available
  if (data.lastResult) {
    showStatusBanner(data.lastResult);
  }
}

// ── Toggle ────────────────────────────────────────────────────────────────
function updateToggleLabel(on) {
  toggleLabel.textContent = on ? "On" : "Off";
}

toggleEl.addEventListener("change", async () => {
  const on = toggleEl.checked;
  updateToggleLabel(on);
  await storageSet({ enabled: on });
});

// ── Subject pills ─────────────────────────────────────────────────────────
function setActivePill(pill, active) {
  if (active) {
    pill.classList.add("bg-blue-600", "border-blue-600", "text-white", "font-semibold");
    pill.classList.remove("bg-gray-100", "border-gray-300", "text-gray-700");
  } else {
    pill.classList.remove("bg-blue-600", "border-blue-600", "text-white", "font-semibold");
    pill.classList.add("bg-gray-100", "border-gray-300", "text-gray-700");
  }
}

pills.forEach(pill => {
  pill.addEventListener("click", async () => {
    pills.forEach(p => setActivePill(p, false));
    setActivePill(pill, true);
    await storageSet({ subject: pill.dataset.subject });
  });
});

// ── Status banner ─────────────────────────────────────────────────────────
function showStatusBanner(result) {
  if (!result) {
    statusBanner.classList.add("hidden");
    return;
  }
  statusBanner.classList.remove("hidden");
  // Reset color classes
  statusBanner.className = statusBanner.className
    .replace(/\b(bg-green-50|text-green-700|bg-amber-50|text-amber-700|bg-blue-50|text-blue-700)\b/g, "")
    .trim();

  if (result.hasError) {
    statusBanner.classList.add("bg-amber-50", "text-amber-700");
    statusBanner.textContent = `⚠️ ${result.location || "Potential issue found in your work."}`;
  } else {
    statusBanner.classList.add("bg-green-50", "text-green-700");
    statusBanner.textContent = "✅ Looking good! No issues detected.";
  }
}

// ── Chat ──────────────────────────────────────────────────────────────────
function appendMessage(text, role) {
  const div = document.createElement("div");
  if (role === "user") {
    div.className = "self-end bg-blue-600 text-white text-sm leading-snug px-3 py-2 rounded-2xl rounded-tr-sm max-w-xs";
  } else if (role === "thinking") {
    div.className = "self-start bg-gray-100 text-gray-400 text-sm italic leading-snug px-3 py-2 rounded-2xl rounded-tl-sm max-w-xs";
  } else {
    div.className = "self-start bg-gray-100 text-gray-800 text-sm leading-snug px-3 py-2 rounded-2xl rounded-tl-sm max-w-xs";
  }
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;

  chatInput.value = "";
  chatSend.disabled = true;

  appendMessage(text, "user");
  const thinking = appendMessage("Thinking…", "thinking");

  try {
    const data = await storageGet(["sessionId", "subject"]);
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "CHAT",
          payload: {
            sessionId: data.sessionId || null,
            message:   text,
          },
        },
        (res) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (!res.ok) return reject(new Error(res.error));
          resolve(res.data);
        }
      );
    });

    if (response.sessionId) {
      await storageSet({ sessionId: response.sessionId });
    }

    thinking.className = "self-start bg-gray-100 text-gray-800 text-sm leading-snug px-3 py-2 rounded-2xl rounded-tl-sm max-w-xs";
    thinking.textContent = response.reply || response.message || "(no reply)";
  } catch (e) {
    thinking.className = "self-start bg-gray-100 text-gray-800 text-sm leading-snug px-3 py-2 rounded-2xl rounded-tl-sm max-w-xs";
    thinking.textContent = `Error: ${e.message}`;
  } finally {
    chatSend.disabled = false;
    chatInput.focus();
  }
}

chatSend.addEventListener("click", sendChat);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

// ── Live status updates from content.js ──────────────────────────────────
// content.js writes lastResult to storage; we pick it up here.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lastResult) {
    showStatusBanner(changes.lastResult.newValue);
  }
});

init();
