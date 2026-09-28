import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import OutputCanvas from "./OutputCanvas";
import TutorChat from "./TutorChat";
import { monacoLanguage, languagesReady } from "./content-type";
import Settings from "./Settings";
import FileMenu from "./FileMenu";
import { editorHintOptions, setLanguageDiagnostics, monacoTheme } from "./monaco-setup";
import "./theme.css";
import "./theme-dark.css";
import "./themes.css";
import "./App.css";

const DEFAULT_FILE = { name: "main.py", code: 'name = input("What\'s your name? ")\nprint("Hello, " + name + "!")\n' };

export default function App() {
  const [file, setFile] = useState(DEFAULT_FILE);
  const [nameInput, setNameInput] = useState(DEFAULT_FILE.name); // separate from file.name so a mid-edit rename doesn't switch files until confirmed
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState(null); // { pointer, ok }
  const [ready, setReady] = useState(false); // gates first render until the language table has loaded — isBrowserNative/monacoLanguage must never run against an empty table
  const [settings, setSettings] = useState({ theme: "light", provider: { preset: "mistral", baseUrl: "", model: "", apiKey: "" } });
  const [saveFailed, setSaveFailed] = useState(false); // a silent autosave failure is worse than most errors here — the tutor reads from disk, so a save that never happened means it's coaching against code the learner already changed
  const saveTimer = useRef(null);

  const loadFile = (filename) =>
    fetch(`/api/file?filename=${encodeURIComponent(filename)}`)
      .then((r) => r.json())
      .then(({ code }) => setFile({ name: filename, code: code !== null ? code : "" }));

  const applySettings = (s) => {
    setSettings(s);
    document.documentElement.dataset.theme = s.theme; // theme-dark.css activates on this attribute — no component re-render needed
    setLanguageDiagnostics(Boolean(s.editorHints));
  };

  // Load whatever's actually on disk on first mount — a refresh should never
  // silently diverge from what was last saved.
  useEffect(() => {
    Promise.all([
      languagesReady,
      loadFile(DEFAULT_FILE.name).catch(() => {}), // if the backend is down at launch, fall back to the in-memory default rather than hanging on "Loading…" forever — confirmed this was a real bug by killing the backend before load
      fetch("/api/settings").then((r) => r.json()).then(applySettings).catch(() => {}), // same non-blocking pattern as languagesReady — a settings fetch failure must never trap the app on "Loading…"
    ]).then(() => setReady(true));
  }, []);

  if (!ready) return <div className="app-loading">Loading…</div>;

  const openFile = () => {
    const name = nameInput.trim();
    if (!name || name === file.name) return;
    // [DESIGN.md, R4] any filename/extension — no restriction, no picker.
    // On failure, snap the visible field back to the file actually loaded —
    // otherwise the filename box and the editor's real content silently
    // disagree, with no sign anything went wrong.
    loadFile(name).catch(() => setNameInput(file.name));
  };

  const onCodeChange = (code) => {
    setFile((f) => ({ ...f, code }));
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, code }),
      })
        .then((r) => setSaveFailed(!r.ok))
        .catch(() => setSaveFailed(true));
    }, 2000); // [DESIGN.md] "Autosaves ~2 seconds after typing stops"
  };

  return (
    <div className="app">
      <header className="app-header">
        <input
          className="file-name-input"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          // Switches files only on Enter. It used to switch on blur too, so
          // stray typing here plus a click elsewhere silently moved the
          // learner to a new file ("WUE") — their edits then saved there while
          // main.py kept the old version. Clicking away now undoes the edit.
          onKeyDown={(e) => { if (e.key === "Enter") openFile(); if (e.key === "Escape") { setNameInput(file.name); e.currentTarget.blur(); } }}
          onBlur={() => setNameInput(file.name)}
          title="File name — type another name and press Enter to open or start that file"
        />
        <FileMenu current={file.name} onOpen={(name) => { setNameInput(name); loadFile(name).catch(() => setNameInput(file.name)); }} />
        {saveFailed && <span className="save-failed">not saved — check connection</span>}
        <span style={{ flex: 1 }} />
        <Settings settings={settings} onChange={applySettings} />
      </header>
      <main className="app-panels">
        <Editor
          className="panel editor-panel"
          // One editor document per file. Without it, switching between two
          // files of the same language could leave the old file's text on
          // screen while the app held the new file's (empty) contents — the
          // next keystroke then saved the old text into the new file.
          path={file.name}
          language={monacoLanguage(file.name)}
          value={file.code}
          onChange={onCodeChange}
          theme={monacoTheme(settings.theme)} // the editor follows the app theme (monaco-setup.js THEMES) — it once stayed light in dark mode
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            // "no pop-ups. No suggestions." by default; Settings → "Editor
            // suggestions" turns Monaco's own autocomplete, hints and error
            // underlines on ("later, if they want to, they can turn active
            // suggestions on"). Nothing to do with the tutor.
            ...editorHintOptions(Boolean(settings.editorHints)),
          }}
        />
        <OutputCanvas
          file={file}
          running={running}
          setRunning={setRunning}
          onRunRecorded={setLastRun}
        />
        <TutorChat lastRun={lastRun} filename={file.name} code={file.code} />
      </main>
    </div>
  );
}
