// Shared by the built-in language runners: a blocking read of one typed
// line from stdin. Their input() calls are synchronous, so they can't use
// Node's event-driven streams. Returns null once the input has ended.
// Blocking line reads from stdin, for runtimes whose input() is synchronous.
const fs = require("fs");
// Private checks (toolchain.js restrictedEnv) set TU_TORUS_ECHO_INPUT. Their
// answers are all queued before the program starts, so each line is echoed
// here, at the moment the program reads it: where a learner typing it would
// see it. Echoed as they were written instead, every answer landed above the
// first prompt, and the tutor compared that screen with the learner's
// (user session, 2026-10-08).
const ECHO = process.env.TU_TORUS_ECHO_INPUT === "1";
const echo = (line) => { if (ECHO && line != null) fs.writeSync(1, line.endsWith("\n") ? line : line + "\n"); return line; };
let pending = Buffer.alloc(0);
let ended = false;
function readLine() {
  for (;;) {
    const nl = pending.indexOf(10);
    if (nl !== -1) { const line = pending.subarray(0, nl + 1); pending = pending.subarray(nl + 1); return echo(line.toString("utf8")); }
    if (ended) { const rest = pending.toString("utf8"); pending = Buffer.alloc(0); return rest.length ? echo(rest) : null; }
    const buf = Buffer.alloc(4096);
    let n;
    try { n = fs.readSync(0, buf, 0, buf.length, null); }
    catch (e) { if (e.code === "EAGAIN") { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); continue; } if (e.code === "EOF") { ended = true; continue; } throw e; }
    if (n === 0) { ended = true; continue; }
    pending = Buffer.concat([pending, buf.subarray(0, n)]);
  }
}
module.exports = { readLine };
