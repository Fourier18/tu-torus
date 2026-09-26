// The tutor's one tool: run the learner's own file privately, with answers
// for its input() prompts supplied up front, and hand back what would have
// appeared on screen. The learner never sees these runs.
//
// Deliberately NOT "run any code the model writes": Pyodide under Node is not
// a sandbox — Python can reach Node (and the filesystem) through the `js`
// module. The learner's own code is already trusted (they run it themselves);
// model-written code isn't. So the model only chooses the typed answers.
import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(__dirname, "..", "engines", "python-worker.js");
const SAB_SIZE = 8 + 65536; // matches python-worker.js's layout
const TIMEOUT_MS = 10000; // includes Pyodide's own startup, ~1-3s
const OUTPUT_CAP = 4000;

export function runLearnerCode({ code, inputs = [] }) {
  return new Promise((resolve) => {
    const sab = new SharedArrayBuffer(SAB_SIZE);
    const sync = new Int32Array(sab, 0, 2);
    const dataBytes = new Uint8Array(sab, 8);
    const worker = new Worker(WORKER, { workerData: { code, sab } });
    const queue = [...inputs];
    let screen = "";
    let errorText = "";
    let done = false;

    const answer = (text) => {
      const len = text == null ? -1 : (() => {
        const bytes = new TextEncoder().encode(text + "\n");
        dataBytes.set(bytes.subarray(0, dataBytes.length));
        return bytes.length;
      })();
      Atomics.store(sync, 1, len);
      Atomics.store(sync, 0, 1);
      Atomics.notify(sync, 0, 1);
    };

    const finish = (extra) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate();
      const cap = (s) => (s.length > OUTPUT_CAP ? `${s.slice(0, OUTPUT_CAP)}\n...[output cut]` : s);
      // Same Pyodide-internal traceback frames tutor.js strips from run records.
      const err = (errorText.trim() || extra || "").replace(/Traceback \(most recent call last\):\n[\s\S]*?(?=  File "<exec>")/g, "Traceback (most recent call last):\n");
      resolve({ screen: cap(screen) || "(nothing appeared on screen)", error: cap(err) || null });
    };

    const timer = setTimeout(() => finish(`Stopped after ${TIMEOUT_MS / 1000}s — it may be stuck in a loop or waiting for more input.`), TIMEOUT_MS);

    worker.on("message", (msg) => {
      if (msg.type === "data") {
        if (msg.stream === "stdout") screen += msg.text; else errorText += msg.text;
      } else if (msg.type === "need-stdin") {
        const next = queue.shift();
        // Echo the typed answer the way a terminal would, so the result reads
        // like what the learner would actually see.
        if (next != null) screen += `${next}\n`;
        answer(next ?? null); // no answers left → EOF, which input() reports as an error
      } else if (msg.type === "exit") {
        finish(msg.ok ? "" : msg.error);
      }
    });
    worker.on("error", (err) => finish(err.message || String(err)));
  });
}
