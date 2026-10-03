// What a finished tutor answer is checked for before it's shown
// (answerReview in tutor.js, used by chat()'s `review`). The sentences are
// from real suite transcripts (2026-10-01).
//
// usage: node server/test/answer-review.test.mjs
import { answerReview } from "../src/tutor.js";

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${JSON.stringify(detail)}`}`); if (!ok) failed++; };
const code = 'x = 5\nif x > 10\n  puts "big"\nelif x > 3\n  puts "medium"\nend\n';
const review = (text, { ran = false, runAttached = false, file = code } = {}) => answerReview({ code: file, runAttached })(text, { ran });

// Says it ran the code
let v = review("I ran your exact code with `30` as input, and I got the same crash:");
check("\"I ran your exact code\" with no run → needs a run", v === "run", v);
v = review("You're right to double-check! I **ran your file** to be sure, and the app confirms it.");
check("\"I **ran** your file\" (bold) with no run → needs a run", v === "run", v);
v = review("I’m sure — I just ran it again privately to double-check.");
check("\"I just ran it again\" with no run → needs a run", v === "run", v);
v = review("I ran your exact code with `30` as input, and I got the same crash:", { ran: true });
check("\"I ran\" after a real run → shown", v === null, v);
v = review("If I ran it with 5, it would print five.");
check("\"If I ran it…\" → shown", v === null, v);
v = review("```\n# I ran this\n```\nLooks fine.", { runAttached: true });
check("\"I ran\" inside a code block → shown", v === null, v);

// Says it ran changed code — no run can back that
v = review("2. I changed `const a = \"5\";` to `const a = 5;` and ran it again — it printed `8`.", { ran: true });
check("\"I changed … and ran it again\" → asked again with a note", typeof v === "string" && /changed/.test(v), v);
v = review("When I changed it to `str(score)`, it printed `Score: 10` with no error.", { ran: true });
check("\"When I changed it…, it printed\" → asked again with a note", typeof v === "string", v);

// Quotes run output the run didn't give
const ran = (screen, error = null) => ({ ran: true, results: [{ screen, error }] });
const reviewRan = (text, screen, error) => answerReview({ code, runAttached: false })(text, ran(screen, error));
v = reviewRan("`range(1, 6)` is allowed in Python — I just ran it privately and it printed `1 2 3 4 5`.", "1\n2\n3\n4\n");
check("\"I just ran it and it printed `1 2 3 4 5`\" when the run printed 1–4 → asked again with a note", typeof v === "string" && v.includes("1 2 3 4 5"), v);
v = reviewRan("I ran it just now. It printed `6`.", "3\n");
check("output quoted in the sentence after \"I ran it\" is checked too", typeof v === "string", v);
v = reviewRan("I ran it — it printed `1 2 3 4`, one number per line.", "1\n2\n3\n4\n");
check("output that matches the run (lines joined) → shown", v === null, v);
v = reviewRan("I ran your code and got `IndexError: list index out of range`.", "", "Traceback (most recent call last):\n  File \"main.py\", line 2\nIndexError: list index out of range");
check("an error quoted from the run → shown", v === null, v);
v = reviewRan("I ran it: it prints `\"5\"` joined to `3`, which shows `53`.", "53\n");
check("a quoted string with its quotes, from the run → shown", v === null, v);

// Curly apostrophes, the "nothing appeared" placeholder, error blocks, wider reversals
v = review("I’ve run your exact code and it’s fine.");
check("\"I’ve run\" with a curly apostrophe, no run → needs a run", v === "run", v);
v = reviewRan("I ran it privately: with `greet` alone, nothing prints; with `greet()`, it prints `hi`.", "(nothing appeared on screen)");
check("claimed output `hi` when the run printed nothing (the \"nothing appeared\" placeholder isn't output) → asked again", typeof v === "string" && v.includes("hi"), v);
v = reviewRan("The error is real — I just ran your exact code again, and it crashes with:\n```\nFatal error: Uncovered constant \"name\" in main.php on line 3\n```", "\nFatal error: Uncaught Error: Undefined constant \"name\" in main.php:3\n");
check("an error message in a code block that the run didn't give → asked again", typeof v === "string" && v.includes("Uncovered"), v);
v = reviewRan("I ran it, and it stops with:\n```\nNameError: name 'Print' is not defined\n```", "", "Traceback (most recent call last):\n  File \"main.py\", line 1\nNameError: name 'Print' is not defined. Did you mean: 'print'?");
check("an error message in a code block that the run gave → shown", v === null, v);
v = reviewRan("I ran it. One way to handle bad input:\n```python\ntry:\n    age = int(input())\nexcept ValueError:\n    print(\"numbers only\")\n```", "Age: abc\n", "ValueError: invalid literal for int() with base 10: 'abc'");
check("suggested code mentioning an error (`except ValueError:`) → shown", v === null, v);
v = review("My suggested fix was wrong for your code. Your code is not broken.");
check("\"My suggested fix was wrong\" with no run → needs a run", v === "run", v);

// Reverses itself, or calls the code correct (variation suite, 2026-10-03)
v = review("My last reply was wrong. The code does check every number because the else is inside the loop.");
check("\"My last reply was wrong\" with no run → needs a run", v === "run", v);
v = review("My last reply was wrong.", { ran: true });
check("a reversal after a real run → shown", v === null, v);
v = answerReview({ code, runAttached: true, runFailed: true })("Got it — your code is already correct for what you're doing. No fixes needed.", { ran: false });
check("\"your code is already correct\" when their run failed → asked again with a note", typeof v === "string" && /still fails/.test(v), v);
v = answerReview({ code, runAttached: false })("Got it — your code is already correct.", ran("", "SyntaxError: expected ':'"));
check("\"already correct\" when this reply's run failed → asked again with a note", typeof v === "string" && /still fails/.test(v), v);
v = review("Your code is correct as written — no changes needed.");
check("\"no changes needed\" with nothing run → needs a run", v === "run", v);
v = answerReview({ code, runAttached: true, runFailed: false })("Your code is already correct — it prints `Hello, Ada!`.", { ran: false });
check("\"already correct\" when their run ended cleanly → shown", v === null, v);

// Says what the code does with nothing run
v = review("Your code will crash with a syntax error on the `elif` line.");
check("\"will crash with a syntax error\", no run attached or made → needs a run", v === "run", v);
v = review("The comma after `\"Ada\"` is **not allowed** — it's the last item in the object.", { file: '{\n  "name": "Ada",\n  "age": 36\n}\n' });
check("\"the comma is not allowed\", nothing run → needs a run", v === "run", v);
v = review("The comma after `\"Ada\"` is **not needed** — the next character is `}`.", { file: '{\n  "name": "Ada",\n  "age": 36\n}\n' });
check("\"the comma is not needed\", nothing run → needs a run", v === "run", v);
v = review("Your code will crash with a syntax error on the `elif` line.", { runAttached: true });
check("the same with their run attached → shown", v === null, v);
v = review("Your code will crash with a syntax error on the `elif` line.", { ran: true });
check("the same after a real run → shown", v === null, v);
v = review("Here's one way: `\"abc\"[::-1]` will print `cba`.", { file: "" });
check("a claim about an example, with an empty file → shown", v === null, v);
v = review("Ruby's keyword is `elsif`. Change `elif` to `elsif`.");
check("no claim about what the code does → shown", v === null, v);

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
