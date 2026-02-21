// content/config.js — Rethink AI
// All tuneable constants in one place.

const BASE_URL     = "http://64.181.214.188:3000";
const PAUSE_MS     = 1800;   // ms of silence before triggering analysis
const MIN_CHARS    = 8;     // minimum document length before calling API
const WINDOW_CHARS = 1200;   // max characters sent to backend
const COOLDOWN_MS  = 8000;   // ms between consecutive API calls
const SHOW_OVERLAY = true;   // debug overlay — set false for demo
const EXPORT_TTL   = 5000;   // ms before re-fetching the export endpoint
