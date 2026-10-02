// The closing-nudge trimmer (src/reply-tidy.js), fed in small pieces the way
// a reply streams: a bare "Try that." at the end goes; everything else stays
// — replies that are only one sentence, code blocks, the app's own notices.
//
// usage: node server/test/reply-tidy.test.mjs
import { createNudgeTrimmer } from "../src/reply-tidy.js";

const through = (text, chunk = 7) => {
  const t = createNudgeTrimmer();
  let out = "";
  for (let i = 0; i < text.length; i += chunk) out += t.push(text.slice(i, i + chunk));
  return out + t.end();
};
const cases = [
  ["closing 'Try that.' dropped", "The comma after 36 is the problem. Remove it. Try that.", "The comma after 36 is the problem. Remove it."],
  ["closing offer question dropped", "Change `=` to `==`.\n\nWant to try it?", "Change `=` to `==`."],
  ["closing 'what do you want…' question dropped", "Use `elsif`. What do you want to print instead?", "Use `elsif`."],
  ["long reply: nudge dropped after the held-back part", "A".repeat(500) + ". Press **Run** to see it.", "A".repeat(500) + "."],
  ["plain answer untouched", "Yes — it runs and prints `hi`.", "Yes — it runs and prints `hi`."],
  ["a reply that is only a nudge stays", "Try running it!", "Try running it!"],
  ["text inside a code block untouched", "Add a colon:\n```python\nif x > 3:\n    print(\"try that\")\n```", "Add a colon:\n```python\nif x > 3:\n    print(\"try that\")\n```"],
  ["one-sentence notice untouched", "Rate limit reached — try again in a minute.", "Rate limit reached — try again in a minute."],
  ["clarifying question kept", "Which part do you think isn't allowed — the comma or the brackets?", "Which part do you think isn't allowed — the comma or the brackets?"],
];
let failed = 0;
for (const [name, input, want] of cases) {
  const got = through(input);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got.slice(-80))}`}`);
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
