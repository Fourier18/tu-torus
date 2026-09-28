// [DESIGN.md, Panel 2] Dispatches to whichever engine a language actually
// needs: Pyodide (in-process, bundled, no install) for Python; an installed
// local toolchain, run as a plain subprocess, for everything else. No
// Docker, no hosted API — see languages.json's `run` field per extension.
import { runPython } from "./engines/python.js";
import { runToolchain } from "./engines/toolchain.js";
import { LANGUAGES } from "./languages.js";

// For a file ending nothing is set up for: tell the learner what does run and
// how to get there, instead of just "can't run this" — built from the language
// table, so a newly added language shows up here without touching this.
export function howToRun(ext) {
  const entries = Object.entries(LANGUAGES).filter(([, l]) => l.name);
  const builtIn = entries.filter(([, l]) => !l.setupOnFirstRun && (l.browserNative || l.run?.engine === "pyodide" || l.run?.bundledNode));
  const firstRun = entries.filter(([, l]) => l.setupOnFirstRun);
  const install = entries.filter(([, l]) => l.run?.installName);
  const list = (xs) => xs.map(([e, l]) => `.${e} (${l.name})`).join(", ");
  const what = ext ? `Files ending in .${ext} aren't set up to run here.` : "This file has no ending (like .py), so Tu-Torus doesn't know what language it is.";
  return `${what} To run code, put it in a file whose name ends in one of these — type the new name (for example main.py) in the file name box at the top left; this file stays saved under its own name.\n\nRun right away: ${list(builtIn)}\nSet themselves up the first time you run them (a one-time download): ${list(firstRun)}\nRun once that language is installed on this computer (Run then shows where to get it): ${list(install)}`;
}

export async function runOnce({ file, ext, code, onData, onExit }) {
  const config = LANGUAGES[ext]?.run;

  if (!config) {
    // [R4] Say so plainly, don't fail silently — this extension has no
    // configured way to run it at all yet (not even "toolchain not found").
    // A language can carry its own explanation (`runNote`) when "run" doesn't
    // apply to it the way it does to a program — CSS, for one.
    onExit({ ok: false, preExecution: true, error: LANGUAGES[ext]?.runNote || howToRun(ext) });
    return { write: () => {}, kill: () => {} };
  }

  if (config.engine === "pyodide") {
    return runPython({ code, onData, onExit });
  }

  // JSON isn't a program, but checking it is what a learner needs from Run —
  // and it gives the tutor a real result instead of its own guess about
  // commas (a live session had it wrong both ways).
  if (config.engine === "json") {
    try {
      JSON.parse(code);
      onData({ stream: "stdout", text: "Valid JSON.\n" });
      onExit({ ok: true, output: "Valid JSON.\n", error: null });
    } catch (e) {
      let pos = Number(/position (\d+)/.exec(e.message)?.[1]);
      let reason = e.message.replace(/ in JSON at position \d+.*$/s, "").replace(/, \.\.\.[\s\S]*$/, "").replace(/, "[\s\S]*" is not valid JSON$/, "");
      if (!Number.isFinite(pos)) {
        // Some errors (a comma before ] or }) come without a position —
        // find a comma right before a closing bracket, outside strings.
        const blanked = code.replace(/"(?:[^"\\]|\\.)*"/g, (m) => " ".repeat(m.length));
        const m = /,(\s*)[\]}]/.exec(blanked);
        if (m) { pos = m.index; reason = `There's a comma after the last item — remove it`; }
      }
      if (Number.isFinite(pos) && /[\]}]/.test(code[pos] ?? "") && /,\s*$/.test(code.slice(0, pos))) {
        pos = code.slice(0, pos).lastIndexOf(",");
        reason = "There's a comma after the last item — remove it";
      }
      let where = "";
      if (Number.isFinite(pos)) {
        const before = code.slice(0, pos).split("\n");
        where = ` (line ${before.length}, column ${before.at(-1).length + 1})`;
      }
      const msg = `Not valid JSON${where}: ${reason}\n`;
      onData({ stream: "stderr", text: msg });
      onExit({ ok: false, output: "", error: msg });
    }
    return { write: () => {}, kill: () => {} };
  }

  return runToolchain({ filename: file, code, config, onData, onExit });
}
