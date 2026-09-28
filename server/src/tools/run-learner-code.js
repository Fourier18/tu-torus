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

// Said outright: with only `error: null`, the tutor read a blank screen as
// "a syntax error, so nothing ran" (Ruby `elif`, which is silently read as a
// method call in a branch that never runs).
const outcome = (error) => error
  ? "It stopped with the error above."
  : "It ran to the end with NO error. If the screen is blank, the code ran but printed nothing.";

// Every other built-in language: the same private run through the app's own
// runner (runner.js), answers typed up front. The logic suite had the tutor
// right about Lua/Ruby/PHP syntax, then agreeing with a learner's false
// pushback — and wrong about BASIC's PRINT with nothing to check against.
export async function runLearnerFile({ filename, code, inputs = [] }) {
  const { runOnce } = await import("../runner.js");
  const ext = filename.split(".").pop().toLowerCase();
  return new Promise((resolve) => {
    let screen = "";
    let errText = "";
    let session = null;
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const cap = (s) => (s.length > OUTPUT_CAP ? `${s.slice(0, OUTPUT_CAP)}\n...[output cut]` : s);
      resolve({ screen: cap(screen) || "(nothing appeared on screen)", error: error ? cap(String(error)) : null, outcome: outcome(error) });
    };
    // The runner pauses its own clock while a program waits for input, so a
    // private run needs a hard limit of its own.
    const timer = setTimeout(() => { session?.kill(); finish(`Stopped after ${TIMEOUT_MS / 1000}s — it may be stuck in a loop or waiting for more input.`); }, TIMEOUT_MS);
    runOnce({
      file: path.basename(filename), ext, code,
      onData: (d) => { if (d.stream === "stderr") errText += d.text; else screen += d.text; },
      onExit: (e) => finish(e.ok ? null : e.error || errText || "It ended with an error."),
    }).then((s) => {
      session = s;
      for (const t of inputs) s.write(String(t).replace(/[\r\n]+/g, " ").trim());
    });
  });
}

export function runLearnerCode({ code, inputs = [] }) {
  return new Promise((resolve) => {
    const sab = new SharedArrayBuffer(SAB_SIZE);
    const sync = new Int32Array(sab, 0, 2);
    const dataBytes = new Uint8Array(sab, 8);
    const worker = new Worker(WORKER, { workerData: { code, sab } });
    // One queued answer = one line typed. Models sometimes send "8\n": with
    // the newline added below that became an extra empty answer, the next
    // input() got "" and crashed, and the tutor blamed the learner's code.
    const queue = inputs.map((s) => String(s).replace(/[\r\n]+/g, " ").trim());
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
      resolve({ screen: cap(screen) || "(nothing appeared on screen)", error: cap(err) || null, outcome: outcome(err) });
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
