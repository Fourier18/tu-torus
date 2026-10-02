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

// Says what the code does with nothing run
v = review("Your code will crash with a syntax error on the `elif` line.");
check("\"will crash with a syntax error\", no run attached or made → needs a run", v === "run", v);
v = review("The comma after `\"Ada\"` is **not allowed** — it's the last item in the object.", { file: '{\n  "name": "Ada",\n  "age": 36\n}\n' });
check("\"the comma is not allowed\", nothing run → needs a run", v === "run", v);
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
