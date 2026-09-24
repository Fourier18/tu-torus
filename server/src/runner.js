// [DESIGN.md, Panel 2] Self-hosted Piston, WebSocket mode only — never REST
// (`/api/v2/execute`), which requires all stdin upfront and breaks any script
// with sequential input() calls. Protocol confirmed by reading Piston's own
// server source (api/src/api/v2.js `/connect` route), since it isn't in the
// published docs: client sends {type:'init',...} once, then
// {type:'data',stream:'stdin',data} to write; server sends
// {type:'data',stream:'stdout'|'stderr',data}, {type:'exit',...}.
import WebSocket from "ws";
import { LANGUAGES } from "./languages.js";

const PISTON_WS = process.env.PISTON_WS_URL || "ws://localhost:2000/api/v2/connect";
const PISTON_HTTP = process.env.PISTON_HTTP_URL || "http://localhost:2000";

let runtimesCache = null; // [DESIGN.md, R4] cached so an unknown extension doesn't hit Piston on every keystroke/run
async function pistonRuntimes() {
  if (runtimesCache) return runtimesCache;
  const res = await fetch(`${PISTON_HTTP}/api/v2/runtimes`);
  runtimesCache = await res.json();
  return runtimesCache;
}

// [DESIGN.md, R4] Unknown-language handling: languages.json (a config table,
// not an if/else) covers cases where we want to pin a version or flag
// browser-native rendering. For everything else, ask Piston itself what it
// already supports — most "unknown" extensions are really just missing from
// our small curated table, not missing from Piston's 70+ languages.
async function resolveRuntime(ext) {
  const pinned = LANGUAGES[ext];
  if (pinned?.language) return pinned;

  const runtimes = await pistonRuntimes();
  const match = runtimes.find((r) => r.language === ext || r.aliases?.includes(ext));
  if (match) return { language: match.language, version: match.version };

  return null; // genuinely not available anywhere — say so plainly, don't guess or fail silently
}

export async function runOnce({ file, ext, code, onData, onExit }) {
  const runtime = await resolveRuntime(ext);
  if (!runtime) {
    // preExecution: true — nothing ran at all, this isn't a bug in the code,
    // it's an environment fact. The output panel shows this plainly instead
    // of the generic crash line, since there's nothing for the tutor to
    // interpret here that the message itself doesn't already say.
    onExit({ ok: false, preExecution: true, error: `No runtime available for .${ext} yet — Piston doesn't have it installed, and it's not in our language table.` });
    return { write: () => {}, kill: () => {} };
  }

  const ws = new WebSocket(PISTON_WS);
  let output = "";
  let errorText = "";
  let stdinQueue = [];
  let ready = false;
  let settled = false; // guards against onExit firing twice (error message + close event both fire for a rejected job)
  const finish = (result) => {
    if (settled) return;
    settled = true;
    // preExecution: Piston never confirmed a runtime, so nothing of the
    // user's code ever ran — an init-time rejection, not a program crash.
    onExit({ preExecution: !ready, ...result });
  };

  ws.on("open", () => {
    ws.send(JSON.stringify({
      type: "init",
      language: runtime.language,
      version: runtime.version,
      files: [{ name: file, content: code }],
    }));
  });

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());

    if (msg.type === "runtime") {
      ready = true;
      stdinQueue.forEach((text) => ws.send(JSON.stringify({ type: "data", stream: "stdin", data: text })));
      stdinQueue = [];
    }
    if (msg.type === "data") {
      if (msg.stream === "stdout") output += msg.data;
      if (msg.stream === "stderr") errorText += msg.data;
      onData({ stream: msg.stream, text: msg.data });
    }
    if (msg.type === "exit") {
      // Compiled languages send TWO exit events — one for the compile stage,
      // one for run — confirmed by connecting directly to Piston and reading
      // the raw stream (Rust: runtime → stage:compile → exit:compile →
      // stage:run → data → exit:run → close). Only the run stage (or a
      // failed compile, which means run never happens) is the real result.
      const ok = (msg.code ?? 1) === 0 && !msg.signal;
      if (msg.stage === "compile" && ok) return; // compiled fine, wait for the run stage
      finish({ ok, output, error: errorText || null, exitCode: msg.code });
    }
    if (msg.type === "error") {
      finish({ ok: false, output, error: msg.message });
    }
  });

  ws.on("close", (code, reason) => {
    // A close with no prior exit/error message (e.g. connection dropped)
    // still needs to resolve the run instead of leaving it hanging forever.
    finish({ ok: false, error: `Piston connection closed: ${reason || code}` });
  });

  return {
    write: (text) => {
      const line = text.endsWith("\n") ? text : text + "\n";
      if (ready) ws.send(JSON.stringify({ type: "data", stream: "stdin", data: line }));
      else stdinQueue.push(line); // buffered until 'runtime' confirms init is done
    },
    kill: () => ws.close(),
  };
}
