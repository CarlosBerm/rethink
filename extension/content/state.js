// content/state.js — Rethink AI
// Shared mutable state. Loaded after config.js.

let lastMouse     = { x: 24, y: 24 };
let tooltip       = null;
let overlay       = null;
let debounceTimer = null;
let lastSentAt    = 0;
let lastSentText  = "";
let activeError   = null;

// Keyboard buffer — typed characters accumulated this session.
// Fills the gap between page load and the first auto-save.
let typedBuffer = "";

// Export cache — avoids hammering the /export endpoint on every keystroke.
let _exportCache = { text: "", ts: 0 };
