// Loaded first in the tutor's private checks (never in the learner's own
// Run). Node's permission system (see toolchain.js) blocks file access
// outside the run folder, starting programs and worker threads, but Node 24
// has no switch for the network, so it's turned off here: every way out
// (TCP and TLS via net.Socket, UDP, DNS, fetch, WebSocket) throws. The
// replacements can't be put back — they're non-writable, non-configurable,
// and the permission system blocks process.binding and workers, which would
// otherwise reach fresh, unpatched copies.
const net = require("net");
const dgram = require("dgram");
const dns = require("dns");

const MESSAGE = "Network access is turned off in the tutor's private check.";
const refuse = () => { const e = new Error(MESSAGE); e.code = "ERR_NETWORK_OFF"; throw e; };
const lock = (obj, key, value) => {
  try { Object.defineProperty(obj, key, { value, writable: false, configurable: false, enumerable: false }); } catch { /* already locked */ }
};

lock(net.Socket.prototype, "connect", refuse);
lock(net, "connect", refuse);
lock(net, "createConnection", refuse);
lock(dgram, "createSocket", refuse);
lock(dgram.Socket.prototype, "send", refuse);
lock(dgram.Socket.prototype, "connect", refuse);
for (const key of ["lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCname", "resolveMx", "resolveNs", "resolveTxt", "resolveSrv", "resolvePtr", "resolveNaptr", "resolveSoa", "reverse"]) {
  if (typeof dns[key] === "function") lock(dns, key, refuse);
  if (dns.promises && typeof dns.promises[key] === "function") lock(dns.promises, key, refuse);
}
if (dns.Resolver) for (const key of Object.getOwnPropertyNames(dns.Resolver.prototype)) {
  if (key !== "constructor" && typeof dns.Resolver.prototype[key] === "function") lock(dns.Resolver.prototype, key, refuse);
}
for (const key of ["fetch", "WebSocket", "EventSource"]) {
  if (key in globalThis) lock(globalThis, key, refuse);
}
