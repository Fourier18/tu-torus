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
