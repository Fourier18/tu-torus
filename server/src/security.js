// Who may talk to this server, and which file names it accepts.
//
// This server can run code on the learner's machine (the /run channel) and
// holds their API key, so it must only ever answer the app itself. Found by
// probing the installed 1.0.2 build (2026-09-26): it listened on every
// network interface (anyone on the Wi-Fi could read the key and run code),
// accepted WebSocket connections from any website (browsers allow
// cross-site WebSockets — visiting a malicious page could run code here),
// answered any Host header (DNS rebinding), and wrote files wherever a
// "../" filename pointed. index.js now binds to 127.0.0.1 and applies these
// checks to every request and every /run connection.

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function localHostname(hostname) {
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase());
}

// Host header, e.g. "localhost:4310", "127.0.0.1:5173", "[::1]:4310".
export function isLocalHost(host) {
  if (!host) return false;
  try { return localHostname(new URL(`http://${host}`).hostname); } catch { return false; }
}

// Origin header, sent by browsers on cross-origin requests and on every
// WebSocket handshake. The app's own pages are http://localhost or
// http://127.0.0.1 (the packaged app on its port, Vite on 5173 in dev). A
// sandboxed learner page in the output iframe sends "null" and is refused.
export function isLocalOrigin(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return u.protocol === "http:" && localHostname(u.hostname);
  } catch { return false; }
}

// Requests may omit Origin (same-origin GETs do); when present it must be
// local. Host must always be local, which is what defeats DNS rebinding.
export function isAllowedRequest({ host, origin }) {
  return isLocalHost(host) && (origin == null || isLocalOrigin(origin));
}

// A plain file name in the workspace: no folders, no "..", and nothing
// starting with "." (which also keeps .tutor/ — settings, API key, notes —
// out of reach of the file routes).
export function safeFileName(name) {
  if (typeof name !== "string") return null;
  const n = name.trim();
  if (!n || n.length > 100 || n.startsWith(".") || /[\\/:*?"<>|\x00-\x1f]/.test(n)) return null;
  return n;
}

// The only run-record path the app itself ever produces (run-records.js).
export function safeRunRecordPath(p) {
  return typeof p === "string" && /^\.tutor\/runs\/\d{3,}\.md$/.test(p) ? p : null;
}
