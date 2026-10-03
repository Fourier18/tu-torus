// Runs a test case's file in the app's own runtime, typing its `inputs` the
// way a learner does: each one after the program has printed its prompt and
// gone quiet. Typed all at once, the echo landed ahead of the prompts ("Ada"
// then "Name: Hello, Ada!"), and that attached run once confused the tutor
// into doubting output that was fine (variation suite, 2026-10-03).
import { runOnce } from "../src/runner.js";

export function runIt(ext, code, inputs = []) {
  return new Promise((resolve) => {
    const queue = [...inputs];
    let out = "", session = null, idle = null, ended = false;
    const finish = (e) => {
      if (ended) return;
      ended = true;
      clearTimeout(limit);
      clearTimeout(idle);
      resolve({ ok: e.ok, output: out, error: e.error ?? "" });
    };
    const limit = setTimeout(() => finish({ ok: false, error: "timeout" }), 60000);
    // The next answer goes in once output has paused (a prompt waiting), or
    // after a longer wait when the program reads without printing a prompt.
    const next = () => {
      if (!session || ended) return;
      if (queue.length) session.write?.(queue.shift());
      if (!queue.length) session.end?.();
    };
    const wait = (ms) => { clearTimeout(idle); idle = setTimeout(next, ms); };
    runOnce({ file: `main.${ext}`, ext, code, onData: (d) => { out += d.text; if (queue.length) wait(400); }, onExit: (e) => finish(e) })
      .then((s) => { session = s; if (queue.length) wait(8000); else s?.end?.(); });
  });
}

// A run record as the app writes it, for attaching to a test message.
export const record = (ext, code, r) => `# Run 1 — main.${ext}\n\n## Code as run\n\`\`\`\n${code}\`\`\`\n\n## Output\n\`\`\`\n${r.output || "(no output)"}\n\`\`\`\n${r.ok ? "\n## Error\n(none)" : `\n## Error\n\`\`\`\n${r.error}\n\`\`\``}`;
