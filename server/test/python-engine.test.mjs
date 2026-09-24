// Proves the Python engine's stdin is genuinely live, not pre-buffered:
// the answer is sent after a real 3-second delay, and the process must
// actually take ~3s to finish — not resolve instantly — for this to be a
// real proof rather than a demo that happens to work.
import { runPython } from "../src/engines/python.js";

const code = 'name = input("What is your name? ")\nprint("Hello, " + name + "!")\n';
const t0 = Date.now();
let accumulated = "";
let sawPromptBeforeAnswer = false;

const session = runPython({
  code,
  onData: ({ stream, text }) => {
    const t = Date.now() - t0;
    console.log(`+${t}ms [${stream}]`, JSON.stringify(text));
    if (stream === "stdout") accumulated += text;
    if (accumulated.includes("What is your name?") && t < 2900) sawPromptBeforeAnswer = true;
  },
  onExit: (result) => {
    const elapsed = Date.now() - t0;
    console.log(`+${elapsed}ms EXIT:`, result);
    const pass = result.ok && elapsed >= 2900 && sawPromptBeforeAnswer;
    console.log(pass ? "PASS" : "FAIL", {
      ok: result.ok,
      elapsedAtLeast3s: elapsed >= 2900,
      promptShownBeforeAnswerSent: sawPromptBeforeAnswer,
    });
    process.exit(pass ? 0 : 1);
  },
});

setTimeout(() => {
  console.log(`+${Date.now() - t0}ms (sending the answer now, after a real 3s wait)`);
  session.write("Joshua");
}, 3000);
