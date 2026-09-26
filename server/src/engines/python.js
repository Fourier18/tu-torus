import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 8-byte header (2 Int32s: signal, length) + 64KB for one input line — matches
// python-worker.js's layout exactly.
const SAB_SIZE = 8 + 65536;

export function runPython({ code, onData, onExit }) {
  const sab = new SharedArrayBuffer(SAB_SIZE);
  const sync = new Int32Array(sab, 0, 2);
  const dataBytes = new Uint8Array(sab, 8);

  const worker = new Worker(path.join(__dirname, "python-worker.js"), {
    workerData: { code, sab },
  });

  let settled = false;
  let output = ""; // [Bug found by the tutor itself] finish() never accumulated this at all — the browser's live stream worked (a separate path, index.js's own accumulator), but the run record — which needs the full text, not just live chunks — was writing "(no output)" for every single successful Python run. toolchain.js already did this correctly; this engine, built later under time pressure, dropped it.
  let errorText = "";
  const finish = ({ ok, error }) => {
    if (settled) return;
    settled = true;
    // Prefer the actually-captured stderr stream (the real, complete
    // traceback text) over the worker's own synthesized error message,
    // which is often just a redundant summary of the same thing — and
    // must never let a null summary silently blank out real stderr text.
    onExit({ ok, output, error: errorText || error || null });
    worker.terminate();
  };

  worker.on("message", (msg) => {
    if (msg.type === "data") {
      if (msg.stream === "stdout") output += msg.text; else errorText += msg.text;
      onData({ stream: msg.stream, text: msg.text });
    }
    if (msg.type === "exit") finish({ ok: msg.ok, error: msg.error || null });
  });

  worker.on("error", (err) => finish({ ok: false, error: err.message || String(err) }));
  worker.on("exit", (code) => { if (code !== 0) finish({ ok: false, error: `Python engine exited unexpectedly (code ${code})` }); });

  return {
    write: (text) => {
      const line = text.endsWith("\n") ? text : text + "\n";
      // Echo what was typed, the way a terminal does — without it the output
      // panel ran prompts and results together on one line ("Enter the first
      // age: Enter the second age: 1.0"), and learners added print() calls
      // to work around the app rather than their code.
      output += line;
      onData({ stream: "stdout", text: line });
      const bytes = new TextEncoder().encode(line);
      dataBytes.set(bytes.subarray(0, dataBytes.length));
      Atomics.store(sync, 1, bytes.length);
      Atomics.store(sync, 0, 1);
      Atomics.notify(sync, 0, 1); // wakes the worker's Atomics.wait — this is what makes it genuinely live, not pre-buffered
    },
    kill: () => {
      Atomics.store(sync, 1, -1);
      Atomics.store(sync, 0, 1);
      Atomics.notify(sync, 0, 1); // unblock a pending read with EOF so terminate() doesn't leave it hung
      finish({ ok: false, error: "Stopped." });
    },
  };
}
