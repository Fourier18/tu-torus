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
  const [lines, setLines] = useState([]);
  const [stdin, setStdin] = useState("");
  const [crashed, setCrashed] = useState(false);
  const [setupError, setSetupError] = useState(null); // distinct from `crashed`: nothing ran at all, so there's a plain reason to show, not a traceback to hide
  const wsRef = useRef(null);
  const nativePage = isBrowserNative(file.name);

  useEffect(() => {
    if (!running) return;
    setLines([]);
    setCrashed(false);
    setSetupError(null);

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
      if (msg.type === "output") setLines((l) => [...l, msg.text]);
      if (msg.type === "exit") {
        exited = true;
        if (!msg.ok) {
          if (msg.preExecution) setSetupError(msg.error);
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

  const sendStdin = () => {
    wsRef.current?.send(JSON.stringify({ type: "stdin", text: stdin }));
    setStdin("");
  };

  if (nativePage) {
    return (
      <div className="panel output-canvas output-canvas-page">
        <iframe title="output" sandbox="allow-scripts" srcDoc={file.code} />
      </div>
    );
  }

  return (
    <div className="panel output-canvas">
      <pre className="output-text">
        {lines.join("")}
        {crashed && <div className="output-error-line">Program stopped with an error</div>}
        {setupError && <div className="output-error-line">{withLinks(setupError)}</div>}
      </pre>
      {running && (
        <div className="stdin-row">
          <input
            autoFocus
            value={stdin}
            onChange={(e) => setStdin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendStdin()}
            placeholder="Type input and press Enter"
          />
        </div>
      )}
    </div>
  );
}
