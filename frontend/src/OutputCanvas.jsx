import { useEffect, useRef, useState } from "react";
import { isBrowserNative } from "./content-type";

// [DESIGN.md, Panel 2, R6] Behaves like a browser — no mode, no toggle.
// Browser-native files (HTML/SVG) render directly, right here, the same as
// opening them would. Everything else runs on the backend (Pyodide or a
// local toolchain, whichever the language needs) and shows its output.
// The Run button works identically either way; which path runs is an
// internal detail, never something the user sees or picks.
// A "needs X installed" message carries that tool's download page — make it
// clickable (Electron's window-open handler sends it to the system browser).
function withLinks(text) {
  return text.split(/(https?:\/\/\S+)/).map((part, i) =>
    /^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer">{part}</a> : part);
}

export default function OutputCanvas({ file, running, setRunning, onRunRecorded }) {
  // Output is collected in a buffer and drawn at most once per frame, and
  // only the last 100,000 characters are kept. Python sends output one
  // character at a time; appending each to a growing list and re-rendering
  // made a printing loop freeze the app, so Stop couldn't even be clicked.
  const [lines, setLines] = useState("");
  const pending = useRef("");
  const frame = useRef(0);
  const flush = () => {
    frame.current = 0;
    const add = pending.current;
    pending.current = "";
    setLines((l) => { const all = l + add; return all.length > 100000 ? all.slice(-100000) : all; });
  };
  const [stdin, setStdin] = useState("");
  const [crashed, setCrashed] = useState(false);
  const [setupError, setSetupError] = useState(null); // distinct from `crashed`: nothing ran at all, so there's a plain reason to show, not a traceback to hide
  const wsRef = useRef(null);
  const stopping = useRef(false); // Stop pressed — the run ends without an error message
  const [pageKey, setPageKey] = useState(0); // bumped by Run on a web page to reload it
  const stdinRef = useRef(null);
  useEffect(() => { if (running) stdinRef.current?.focus(); }, [running]); // once per run, so typing in the editor meanwhile isn't interrupted
  const nativePage = isBrowserNative(file.name);

  useEffect(() => {
    if (!running) return;
    setLines("");
    pending.current = "";
    stopping.current = false;
    setCrashed(false);
    setSetupError(null);
    setStdin(""); // leftover typing from the last run doesn't carry into this one

    if (nativePage) {
      // No execution, nothing to run — this is just what the content is.
      setRunning(false);
      return;
    }

    const ws = new WebSocket(`ws://${location.host}/run`);
    wsRef.current = ws;
    let exited = false; // distinguishes a real exit from the connection just dying — without this, a backend crash mid-run leaves "Running…" stuck forever with no way to recover except a page reload (confirmed by actually killing the backend mid-run)
    ws.onopen = () => ws.send(JSON.stringify({ type: "start", filename: file.name, code: file.code }));
    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === "output") { pending.current += msg.text; if (!frame.current) frame.current = requestAnimationFrame(flush); }
      if (msg.type === "exit") {
        exited = true;
        setStdin("");
        if (frame.current) { cancelAnimationFrame(frame.current); flush(); } // show the last output before the run ended
        if (!msg.ok && !stopping.current) {
          if (msg.preExecution) setSetupError(msg.error);
          else if (msg.reason) setSetupError(msg.reason);
          else setCrashed(true);
        }
        setRunning(false);
      }
      if (msg.type === "run-recorded") onRunRecorded({ pointer: msg.pointer, ok: msg.ok });
    };
    ws.onclose = () => {
      if (!exited) {
        setSetupError("Lost connection to the run server.");
        setRunning(false);
      }
    };
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // There was no way to end a run: a loop kept going, and Escape / Ctrl+C
  // did nothing. Stop kills the program (or its compile) on the server.
  const stop = () => {
    stopping.current = true;
    wsRef.current?.send(JSON.stringify({ type: "stop" }));
  };

  const sendStdin = () => {
    wsRef.current?.send(JSON.stringify({ type: "stdin", text: stdin }));
    setStdin("");
  };

  // Run sits at the bottom right of this panel, beside the box for typing
  // input, like Send beside a chat box. For a web page, Run reloads it.
  const bar = (
    <div className="output-bar">
      <input
        value={stdin}
        disabled={!running || nativePage}
        ref={stdinRef}
        onChange={(e) => setStdin(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") sendStdin(); if (e.key === "c" && e.ctrlKey && running) { e.preventDefault(); stop(); } }}
        placeholder={running ? "Type input and press Enter" : ""}
      />
      <button className="run-btn" onClick={() => (running ? stop() : nativePage ? setPageKey((k) => k + 1) : setRunning(true))} title={running ? "Stop the program (Ctrl+C in the input box)" : undefined}>
        {running ? "Stop" : "Run"}
      </button>
    </div>
  );

  if (nativePage) {
    return (
      <div className="panel output-canvas output-canvas-page">
        <iframe key={pageKey} title="output" sandbox="allow-scripts" srcDoc={file.code} />
        {bar}
      </div>
    );
  }

  return (
    <div className="panel output-canvas">
      <div className="output-scroll">
        <pre className="output-text">
          {lines}
          {crashed && <div className="output-error-line">Program stopped with an error</div>}
          {setupError && <div className="output-error-line">{withLinks(setupError)}</div>}
        </pre>
      </div>
      {bar}
    </div>
  );
}
