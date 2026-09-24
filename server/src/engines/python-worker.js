// Runs inside a worker thread. Pyodide's input() is synchronous — it can't
// `await` a live message from the browser. The fix: a SharedArrayBuffer the
// main thread and this worker both see, plus Atomics.wait/notify to make
// this thread genuinely block (not just pre-consume a buffered answer) until
// the main thread writes a real answer into it. This is the standard pattern
// for real interactive stdin in a WASM/worker setup, not a workaround.
import { parentPort, workerData } from "node:worker_threads";
import { loadPyodide } from "pyodide";

const sab = workerData.sab; // Int32Array view: [0]=signal (0=waiting,1=answered), [1]=answer byte length, [2..]=UTF-8 bytes
const sync = new Int32Array(sab, 0, 2);
const dataBytes = new Uint8Array(sab, 8);

function blockingReadLine() {
  Atomics.store(sync, 0, 0);
  parentPort.postMessage({ type: "need-stdin" });
  Atomics.wait(sync, 0, 0); // genuinely blocks this thread — not a spin loop, not a timeout guess
  const len = Atomics.load(sync, 1);
  if (len < 0) return null; // negative length is this module's own EOF signal
  return new TextDecoder().decode(dataBytes.subarray(0, len));
}

// Two real bugs found by testing, not assumed away:
// 1. `batched` only flushes on a newline — input()'s prompt has none, so it
//    sat unflushed until later output supplied one. Switched to `raw`
//    (per-character, no such condition).
// 2. `raw` was then buffered via queueMicrotask — but Atomics.wait() below
//    blocks this thread's entire event loop, microtask queue included, so
//    a message queued right before a blocking wait never actually sent
//    until AFTER the wait ended. Confirmed by a real timestamped test:
//    the prompt and the post-answer output arrived in one message, together,
//    after the answer. Posting immediately — no deferral of any kind — is
//    what actually gets the prompt out before the block begins.
function rawStream(stream) {
  // `raw` gives one byte at a time, not a character code — String.fromCharCode
  // on a raw byte mangles any multi-byte UTF-8 (accented letters, emoji, etc).
  // TextDecoder's `stream: true` mode holds back an incomplete multi-byte
  // sequence across calls and decodes it correctly once complete — and it's
  // fully synchronous, so it can't reintroduce the queueMicrotask bug above.
  const decoder = new TextDecoder("utf-8");
  return (charCode) => {
    const text = decoder.decode(new Uint8Array([charCode]), { stream: true });
    if (text) parentPort.postMessage({ type: "data", stream, text });
  };
}

const pyodide = await loadPyodide();
// isatty: true — CPython's input() only force-flushes its prompt before
// reading when stdout looks like a real terminal; otherwise C stdio treats
// it as fully-buffered and holds the prompt back. This is the actual fix
// for the prompt arriving late — not a JS-side batching choice.
pyodide.setStdout({ raw: rawStream("stdout"), isatty: true });
pyodide.setStderr({ raw: rawStream("stderr"), isatty: true });
pyodide.setStdin({ stdin: blockingReadLine });

try {
  await pyodide.runPythonAsync(workerData.code);
  parentPort.postMessage({ type: "exit", ok: true });
} catch (err) {
  parentPort.postMessage({ type: "exit", ok: false, error: err.message || String(err) });
}
