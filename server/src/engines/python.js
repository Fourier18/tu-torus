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
  const finish = (result) => {
    if (settled) return;
    settled = true;
    onExit(result);
    worker.terminate();
  };

  worker.on("message", (msg) => {
    if (msg.type === "data") onData({ stream: msg.stream, text: msg.text });
    if (msg.type === "exit") finish({ ok: msg.ok, error: msg.error || null });
  });

  worker.on("error", (err) => finish({ ok: false, error: err.message || String(err) }));
  worker.on("exit", (code) => { if (code !== 0) finish({ ok: false, error: `Python engine exited unexpectedly (code ${code})` }); });

  return {
    write: (text) => {
      const bytes = new TextEncoder().encode(text.endsWith("\n") ? text : text + "\n");
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
