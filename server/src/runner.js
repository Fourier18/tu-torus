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
    onExit({ ok: false, preExecution: true, error: `Nothing configured to run .${ext} files yet.` });
    return { write: () => {}, kill: () => {} };
  }

  if (config.engine === "pyodide") {
    return runPython({ code, onData, onExit });
  }

  return runToolchain({ filename: file, code, config, onData, onExit });
}
