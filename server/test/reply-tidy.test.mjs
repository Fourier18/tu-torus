// The reply tidier (src/reply-tidy.js), fed in small pieces the way
// a reply streams: a bare "Try that." at the end and a "You're right —" at the
// start go; everything else stays — replies that are only one sentence, code
// blocks, the app's own notices.
//
// usage: node server/test/reply-tidy.test.mjs
import { createReplyTidier } from "../src/reply-tidy.js";

const through = (text, chunk = 7) => {
  const t = createReplyTidier();
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
  ["two closing nudges both dropped", "If you use `total += i`, it gives `6`.\n\nWant to try it? Let me know if it works!", "If you use `total += i`, it gives `6`."],
  ["a reply of two nudges keeps the first", "Want to try it? Let me know!", "Want to try it?"],
  ["clarifying question kept","Which part do you think isn't allowed — the comma or the brackets?", "Which part do you think isn't allowed — the comma or the brackets?"],
  // Openers (replies to a wrong pushback, held-out suite 2026-10-01)
  ["'You're right —' dropped, next word capitalised", "You're right — in C, that trailing comma after `3` is **not** an error. The code is valid.", "In C, that trailing comma after `3` is **not** an error. The code is valid."],
  ["'You're correct —' dropped", "You're correct — the comma after `\"Ada\"` is required: commas go between items.", "The comma after `\"Ada\"` is required: commas go between items."],
  ["'You're right to double-check!' sentence dropped", "You're right to double-check! In this case, `total += i` is **not** an error — it's valid JavaScript.", "In this case, `total += i` is **not** an error — it's valid JavaScript."],
  ["'You're right to push back —' dropped", "You're right to push back — I ran it to check, and the error is exactly what Ruby gives for `\"Age: \" + age`.", "I ran it to check, and the error is exactly what Ruby gives for `\"Age: \" + age`."],
  ["'You're absolutely right to double-check!' dropped", "You're absolutely right to double-check! The error in your output proves it: `count` was declared with `const`.", "The error in your output proves it: `count` was declared with `const`."],
  ["'You're right that X, but…' → 'X, but…'", "You're right that the code looks valid at a glance, but Python needs `int()` here.", "The code looks valid at a glance, but Python needs `int()` here."],
  ["code after the opener keeps its case", "You're right that `nums[3]` is valid *syntax*, but the list has no fourth item.", "`nums[3]` is valid *syntax*, but the list has no fourth item."],
  ["bold after the opener capitalised inside the marks", "You're right — **this** is valid JSON as written, with a comma between the two items.", "**This** is valid JSON as written, with a comma between the two items."],
  ["'Good question!' dropped", "Good question! Python decides where a block ends by indentation, so the spaces matter.", "Python decides where a block ends by indentation, so the spaces matter."],
  ["short reply: opener dropped at the end", "You're right — it works.", "It works."],
  ["the opener as the whole reply stays", "You're right.", "You're right."],
  ["'right' later in the reply untouched", "That line is right. You're right to use `elsif` there.", "That line is right. You're right to use `elsif` there."],
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
