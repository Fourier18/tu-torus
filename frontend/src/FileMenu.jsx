import { useEffect, useRef, useState } from "react";

// The ▾ beside the file name: the learner's saved files (click to open) and
// New file with a language list that fills in the right ending. Typing a
// name in the name box and pressing Enter still works as a shortcut.
// Before this, the only way to switch files was that box, and nothing on
// screen said so — a learner wanting BASIC thought they had to empty main.py.
export default function FileMenu({ current, onOpen }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [creating, setCreating] = useState(false);
  const [ext, setExt] = useState("py");
  const [name, setName] = useState("");
  const [problem, setProblem] = useState(""); // why Create didn't work, e.g. a name Windows reserves
  const box = useRef(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/files").then((r) => r.json()).then(setFiles).catch(() => setFiles([]));
    fetch("/api/languages").then((r) => r.json())
      .then((L) => setLanguages(Object.entries(L).filter(([, l]) => l.name && l.monaco).map(([e, l]) => ({ ext: e, name: l.name.replace(/^a (.)/, (_, c) => c.toUpperCase()) }))))
      .catch(() => {});
    const away = (e) => { if (!box.current?.contains(e.target)) close(); };
    const esc = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const close = () => { setOpen(false); setCreating(false); setName(""); setProblem(""); };

  const create = async () => {
    const base = name.trim().replace(/\.[^.]*$/, "") || "untitled";
    let file = `${base}.${ext}`;
    // Don't open an existing file under the guise of "new" — pick a free name.
    for (let n = 2; files.some((f) => f.name.toLowerCase() === file.toLowerCase()); n++) file = `${base}${n}.${ext}`;
    const r = await fetch("/api/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file, code: "" }) });
    if (r.ok) { onOpen(file); close(); return; }
    setProblem((await r.json().catch(() => ({}))).error || "that file couldn't be created");
  };

  return (
    <div className="file-menu" ref={box}>
      <button className="file-menu-toggle" onClick={() => (open ? close() : setOpen(true))} aria-label="Files" title="Files">▾</button>
      {open && (
        <div className="file-menu-panel">
          {!creating ? (
            <button className="file-menu-new" onClick={() => setCreating(true)}>+ New file</button>
          ) : (
            <div className="file-menu-create">
              <select value={ext} onChange={(e) => setExt(e.target.value)} aria-label="Language">
                {languages.map((l) => <option key={l.ext} value={l.ext}>{l.name} (.{l.ext})</option>)}
              </select>
              <div className="file-menu-name">
                <input autoFocus value={name} placeholder="name" onChange={(e) => { setName(e.target.value); setProblem(""); }} onKeyDown={(e) => e.key === "Enter" && create()} aria-label="File name" />
                <span>.{ext}</span>
              </div>
              <button className="file-menu-create-btn" onClick={create}>Create</button>
              {problem && <div className="file-menu-problem" role="alert">Not created — {problem}.</div>}
            </div>
          )}
          <div className="file-menu-list">
            {files.map((f) => (
              <button key={f.name} className={`file-menu-item${f.name === current ? " current" : ""}`} onClick={() => { onOpen(f.name); close(); }}>{f.name}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
