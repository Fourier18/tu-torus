// The editor ships with the app. @monaco-editor/react on its own fetches
// Monaco from cdn.jsdelivr.net at every launch — the editor panel stayed
// blank on a machine that had never been online (or after a cache clear),
// and the app ran code from a third-party server. Pointing its loader at the
// bundled copy fixes both; the language workers (JS/TS IntelliSense, HTML,
// CSS, JSON) are bundled by Vite as their own files.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import CssWorker from "monaco-editor/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "json") return new JsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new CssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker();
    if (label === "typescript" || label === "javascript") return new TsWorker();
    return new EditorWorker();
  },
};

loader.config({ monaco });

// Editor colors for each app theme (themes.css / theme-dark.css hold the
// rest of the app's colors — keep them in step). Syntax colors come from
// Monaco's own light or dark base; the page colors match the theme.
export const THEMES = {
  light: { label: "Light (default)", monaco: "vs" },
  dark: { label: "Dark", monaco: "vs-dark" },
  forest: { label: "Forest Green", base: "vs-dark", bg: "#13201a", fg: "#dfeee4", line: "#182a21", dim: "#5f7d69", accent: "#4caf7a" },
  "azure-night": { label: "Azure Night", base: "vs-dark", bg: "#0d1b2e", fg: "#e3ecf7", line: "#12233a", dim: "#5a7394", accent: "#3d9bff" },
  "desert-sunset": { label: "Desert Sunset", base: "vs", bg: "#fdf6ec", fg: "#3a2a1c", line: "#f6e7d3", dim: "#b0906f", accent: "#b8501f" },
  "arctic-dawn": { label: "Arctic Dawn", base: "vs", bg: "#f5f9fc", fg: "#1b2a36", line: "#e9f1f7", dim: "#8ea3b4", accent: "#16788e" },
  "plum-midnight": { label: "Plum Midnight", base: "vs-dark", bg: "#1c1524", fg: "#eee6f5", line: "#231a2e", dim: "#75648a", accent: "#b77ce8" },
};

for (const [name, t] of Object.entries(THEMES)) {
  if (t.monaco) continue;
  monaco.editor.defineTheme(`tutorus-${name}`, {
    base: t.base, inherit: true, rules: [],
    colors: {
      "editor.background": t.bg, "editor.foreground": t.fg,
      "editor.lineHighlightBackground": t.line, "editorLineNumber.foreground": t.dim,
      "editorLineNumber.activeForeground": t.fg, "editorCursor.foreground": t.accent,
      "editor.selectionBackground": `${t.accent}55`, "editorGutter.background": t.bg,
    },
  });
}

export function monacoTheme(name) {
  const t = THEMES[name] ?? THEMES.light;
  return t.monaco ?? `tutorus-${name}`;
}

// Editor hints (Settings → "Editor suggestions"): off by default — no pop-ups,
// no completions, no red underlines, no hover info — until the learner turns
// them on. The options go on the <Editor>; the error underlines for JS/TS,
// CSS and JSON come from the language services and are switched here.
export function editorHintOptions(on) {
  return {
    quickSuggestions: on,
    suggestOnTriggerCharacters: on,
    parameterHints: { enabled: on },
    wordBasedSuggestions: on ? "currentDocument" : "off",
    inlineSuggest: { enabled: false },
    hover: { enabled: on },
    lightbulb: { enabled: on ? "on" : "off" },
  };
}

export function setLanguageDiagnostics(on) {
  const ts = { noSemanticValidation: !on, noSyntaxValidation: !on, noSuggestionDiagnostics: !on };
  monaco.typescript.typescriptDefaults.setDiagnosticsOptions(ts);
  monaco.typescript.javascriptDefaults.setDiagnosticsOptions(ts);
  monaco.css.cssDefaults.setOptions({ validate: on });
  monaco.json.jsonDefaults.setDiagnosticsOptions({ validate: on });
}
