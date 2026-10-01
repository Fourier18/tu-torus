// The tutor's one tool: run the learner's own file privately, with answers
// for its input prompts supplied up front, and hand back what would have
// appeared on screen. The learner never sees these runs.
//
// Deliberately NOT "run any code the model writes": the model only chooses
// the typed answers. And since these runs happen without the learner
// pressing Run, every one goes through runner.js runPrivately: a separate
// process with file access limited to its own folder, no programs started,
// no network and no environment variables (toolchain.js `restricted`).
import path from "node:path";

const TIMEOUT_MS = 12000; // includes the runtime's own startup (Pyodide ~1-3 s)
const OUTPUT_CAP = 4000;

// Said outright: with only `error: null`, the tutor read a blank screen as
// "a syntax error, so nothing ran" (Ruby `elif`, which is silently read as a
// method call in a branch that never runs). The restrictions are named so a
// permission error isn't blamed on the learner's code.
const outcome = (error) => (error
  ? "It stopped with the error above."
  : "It ran to the end with NO error. If the screen is blank, the code ran but printed nothing.")
  + " (In this private check the program can't use files outside its own folder, start other programs or use the network; an access-denied or network-off error comes from that, not from their code.)";

export async function runLearnerFile({ filename, code, inputs = [] }) {
  const { runPrivately } = await import("../runner.js");
  const ext = filename.split(".").pop().toLowerCase();
  return new Promise((resolve) => {
    let screen = "";
    let errText = "";
    let session = null;
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const cap = (s) => (s.length > OUTPUT_CAP ? `${s.slice(0, OUTPUT_CAP)}\n...[output cut]` : s);
      resolve({ screen: cap(screen) || "(nothing appeared on screen)", error: error ? cap(String(error)) : null, outcome: outcome(error) });
    };
    // The runner pauses its own clock while a program waits for input, so a
    // private run needs a hard limit of its own.
    const timer = setTimeout(() => { session?.kill(); finish(`Stopped after ${TIMEOUT_MS / 1000}s — it may be stuck in a loop or waiting for more input.`); }, TIMEOUT_MS);
    runPrivately({
      file: path.basename(filename), ext, code,
      onData: (d) => { if (d.stream === "stderr") errText += d.text; else screen += d.text; },
      onExit: (e) => finish(e.ok ? null : e.error || errText || "It ended with an error."),
    }).then((s) => {
      session = s;
      // One answer = one line typed. Models sometimes send "8\n"; a stray
      // newline used to become an extra empty answer.
      for (const t of inputs) s.write(String(t).replace(/[\r\n]+/g, " ").trim());
      // Then end of input, as when answers run out in a terminal: the next
      // input() reports it at once instead of the check waiting out the limit.
      s.end?.();
    });
  });
}

// Python, kept under its old name for callers (student-sim.mjs).
export function runLearnerCode({ code, inputs = [] }) {
  return runLearnerFile({ filename: "main.py", code, inputs });
}
