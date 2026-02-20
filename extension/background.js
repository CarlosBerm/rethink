// background.js — Service worker (MV3)
// Proxies all fetch calls to the backend so content scripts avoid
// mixed-content blocks (Google Docs is HTTPS; backend is HTTP).
// Service workers run in the extension context, not a web page context,
// so they are exempt from the browser's mixed-content policy.

const BASE_URL = "http://64.181.214.188:3000";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "ANALYZE") {
    console.log(`[Rethink BG] → POST /analyze`, message.payload);
    fetch(`${BASE_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload)
    })
      .then(r => {
        if (!r.ok) return r.text().then(t => { throw new Error(`API error ${r.status}: ${t}`); });
        return r.json();
      })
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep message channel open for async response
  }

  if (message.type === "CHAT") {
    fetch(`${BASE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload)
    })
      .then(r => {
        if (!r.ok) return r.text().then(t => { throw new Error(`API error ${r.status}: ${t}`); });
        return r.json();
      })
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
