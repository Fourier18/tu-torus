// [DESIGN.md, Panel 2] Dispatches to whichever engine a language actually
// needs: Pyodide (in-process, bundled, no install) for Python; an installed
// local toolchain, run as a plain subprocess, for everything else. No
// Docker, no hosted API — see languages.json's `run` field per extension.
import { runPython } from "./engines/python.js";
import { runToolchain } from "./engines/toolchain.js";
import { LANGUAGES } from "./languages.js";

export async function runOnce({ file, ext, code, onData, onExit }) {
  const config = LANGUAGES[ext]?.run;

  if (!config) {
    // [R4] Say so plainly, don't fail silently — this extension has no
    // configured way to run it at all yet (not even "toolchain not found").
    // A language can carry its own explanation (`runNote`) when "run" doesn't
    // apply to it the way it does to a program — CSS, for one.
    onExit({ ok: false, preExecution: true, error: LANGUAGES[ext]?.runNote || `Tu-Torus can't run .${ext} files yet. Python and JavaScript run built in, web pages (.html) show directly, and several other languages run once their tools are installed.` });
    return { write: () => {}, kill: () => {} };
  }

  if (config.engine === "pyodide") {
    return runPython({ code, onData, onExit });
  }

  return runToolchain({ filename: file, code, config, onData, onExit });
}
