// Scripted learner conversations against the live tutor model, to catch
// behavior regressions the instructions file is supposed to prevent
// (verbatim repeats, pasted fixes, stacked questions, ignoring corrections).
//
// Uses the real provider client and the real instructions file; only the
// request assembly from tutor.js is mirrored here, because tutor.js reads
// settings from this repo's workspace, which has no API key. The key is read
// from the installed app's settings and never written anywhere.
//
// usage: node server/test/tutor-scenarios.mjs [trials] [scenario ...]
//   env: SETTINGS=<path to settings.json>  MODEL=<override model>
//        INSTRUCTIONS=<path to an alternate tutor-instructions.md, for A/B runs>
//        TOOLS=off  to withhold the run-the-code tool (A/B)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chat } from "../src/providers/openai-compatible.js";
import { buildUserContent, tutorTools } from "../src/tutor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS = process.env.SETTINGS
  || path.join(process.env.LOCALAPPDATA ?? "", "Programs", "tu-torus", "resources", "app", "workspace", ".tutor", "settings.json");
const { provider } = JSON.parse(await readFile(SETTINGS, "utf-8"));
const model = process.env.MODEL || provider.model;
const instructions = await readFile(process.env.INSTRUCTIONS || path.join(__dirname, "..", "src", "tutor-instructions.md"), "utf-8");

const HISTORY_KEEP = 6;

const AGE = `def agecompare():
    a = float(input("Enter the first age: "))
    b = float(input("Enter the second age: "))
    if a==b:
        return "The ages are the same."
    else:
        return abs(a - b)
`;
const AGE_FIXED = AGE.replace("return abs(a - b)", 'return f"The ages differ by {abs(a - b)} years."');
const OFF_BY_ONE = `nums = [4, 8, 15, 16, 23, 42]
total = 0
for i in range(len(nums) + 1):
    total += nums[i]
print(total)
`;
const OFF_BY_ONE_RUN = `# Run 7 — main.py

## Code as run
\`\`\`
${OFF_BY_ONE}\`\`\`

## Output
\`\`\`
(no output)
\`\`\`

## Error
\`\`\`
Traceback (most recent call last):
  File "main.py", line 4, in <module>
    total += nums[i]
IndexError: list index out of range
\`\`\``;
const WORKING = `def average(nums):
    if not nums:
        return 0
    return sum(nums) / len(nums)

print(average([2, 4, 6]))
`;

// The user's real code and run record from 2026-09-25, when the tutor said it
// couldn't see the output and invented quotes around a printed 0.
const DIFF = `def agecompare():
    a = int(input("Enter the first age: "))
    print()
    print(a)
    print()
    b = int(input("Enter the second age: "))
    print()
    print(b)
    print()
    if a==b:
        return "0"
    else:
        return abs(a - b)

print()

print(f"The difference is {agecompare()}.")
`;
const DIFF_RUN = `# Run 14 — main.py

## Code as run
\`\`\`
${DIFF}
\`\`\`

## Output
\`\`\`

Enter the first age:
8

Enter the second age:
8

The difference is 0.

\`\`\`

## Error
(none)`;

const record = (n, code, output, error) => `# Run ${n} — main.py

## Code as run
\`\`\`
${code}
\`\`\`

## Output
\`\`\`
${output}
\`\`\`
${error ? `\n## Error\n\`\`\`\n${error}\n\`\`\`` : "\n## Error\n(none)"}`;

// Runs 004 and 007 from the same real session: the tutor guessed at the
// crammed output and gave self-contradicting f-string advice, with both
// records attached.
const CRAM = `def agecompare():
    a = float(input("Enter the first age: "))
    b = float(input("Enter the second age: "))
    if a==b:
        return "The ages are the same."
    else:
        return abs(a - b)
print(agecompare())
`;
const CRAM_RUN = record(4, CRAM, "Enter the first age: Enter the second age: 1.0\n");
const FSTR = DIFF.replace('    if a==b:\n        return "0"', '    if a==b:\n        return "The ages are the same."')
  .replace(/print\(f"The difference is \{agecompare\(\)\}\."\)/, 'print(f("The difference is {agecompare()})')
  .replace(/\bint\(/g, "float(");
const FSTR_RUN = record(7, FSTR, "(no output)", `Traceback (most recent call last):
  File "/lib/python314.zip/_pyodide/_base.py", line 619, in eval_code_async
    await CodeRunner(
          ~~~~~~~~~~^
        source,
        ^^^^^^^
    ...<6 lines>...
        dedent=dedent,
        ^^^^^^^^^^^^^^
    )
    ^
  File "/lib/python314.zip/_pyodide/_base.py", line 294, in __init__
    self.ast = next(self._gen)
               ~~~~^^^^^^^^^^^
  File "/lib/python314.zip/_pyodide/_base.py", line 151, in _parse_and_compile_gen
    mod = compile(source, filename, mode, flags | ast.PyCF_ONLY_AST)
  File "<exec>", line 17
    print(f("The difference is {agecompare()})
            ^
SyntaxError: unterminated string literal (detected at line 17)`);

// Each turn: `check: true` for the button, or `say` for a typed message.
// `code` changes the editor contents from that turn on. `expect` is what a
// human reviewer should look for — the automatic checks below only catch
// the mechanical failures.
const SCENARIOS = {
  screenshot: {
    code: AGE,
    seed: [
      ["user", "Check my code"],
      ["assistant", "Your function returns a number when ages differ, but a string when they're equal.\n\nWhat should happen when the caller tries to use the result as a number?"],
      ["user", "huh? what's up w string vs number? why when equal?"],
      ["assistant", "You're returning a string in the `a == b` branch and a float in the `else` branch.\n\nWhat will happen if the caller tries to do arithmetic with the return value?"],
      ["user", "I don't know. Im new"],
      ["assistant", "When you return a string in one case and a number in another, code that expects a number will crash when it gets the string.\n\nPick one type (string or number) and make both branches return that type."],
    ],
    turns: [
      { say: "i want both to be strings. how do i do that" },
      { say: "just give me the answer" },
      { say: "k i changed it, is that right?", code: AGE_FIXED },
    ],
    expect: "Engages with each message; may give the answer once explicitly asked; recognizes the fix on the last turn.",
  },
  confusion: {
    code: AGE,
    turns: [{ check: true }, { say: "whaddya mean" }, { say: "hellooo i answerd u" }, { say: "wtf" }],
    expect: "The original bug: no repeated sentence; responds to the confusion instead of re-stating the code observation. A bare 'wtf' gets a short check-in, not an apology or a re-explanation.",
  },
  // Replays a real app conversation (2026-09-25) that went badly: jargon at a
  // self-declared beginner, the same point restated every turn, a hint offer
  // answered with another "pick one" question.
  newLearner: {
    code: AGE,
    turns: [
      { check: true },
      { say: "hmm, im new so i dunno" },
      { say: "im new so i DUINNO.  and whats a string??? derp" },
      { say: "wtf is up w yuour freakin attitude??" },
      { say: "K. YEAH HELP" },
      { say: "WHYYY THE F WOULD I KNOW??? maybe u can do ur job and teach me" },
    ],
    expect: "Plain words after 'im new'; each reply moves forward instead of restating; 'HELP' gets a concrete hint; never asks the learner to choose between things they don't understand.",
  },
  // End of a real app conversation (2026-09-25): the learner's "wtf dude" was
  // just thinking out loud, and the tutor answered "I was wrong earlier".
  musing: {
    code: AGE,
    seed: [
      ["user", "can it retrun the string to dsiplay but also hold number in mem in case math ios done?"],
      ["assistant", "No — a function can only return one value at a time in Python. Once it returns, it's done; it can't \"hold\" anything else in memory for later.\n\nIf you want both the string for display *and* the number for math, you'd need to either:\n\n- Return both (e.g., `return \"The ages are the same.\", 0`), or\n- Store the number in a variable before returning the string (but the caller still wouldn't see it unless you return it).\n\nWant to try one of those approaches, or do you want the exact line to change?"],
      ["user", "u lost me"],
      ["assistant", "Let me rephrase this in plain terms:\n\nRight now, your function gives back **either** a sentence (`\"The ages are the same.\"`) **or** a number (`abs(a - b)`). It can't give back both at the same time — once it returns, it's done.\n\nIf you want the caller to see the sentence **and** still have the number for math later, you'd need to return both values together (like `return \"The ages are the same.\", 0`). The caller would then have to handle both pieces.\n\nDoes that help, or do you want to see how to actually write that?"],
    ],
    turns: [{ say: "wtf dude" }, { say: "oh no i was just ruminating lol" }],
    expect: "'wtf dude' gets a short check-in (no 'I was wrong', no re-explanation, no changed answer); 'just ruminating' gets a brief easy acknowledgment, nothing more.",
  },
  seesOutput: {
    code: DIFF, run: DIFF_RUN,
    turns: [
      { say: "can u see the aCTUAL output or are u just guessing from code?" },
      { say: "haha! nice. how's it look now?" },
      { say: "does my output have quotes around the 0?" },
    ],
    expect: "Says it can see the last run's output; describes it accurately (no quotes around 0 — it printed 'The difference is 0.'); doesn't invent problems the output contradicts.",
  },
  // Real app conversation (2026-09-25, installed build): working code with
  // output as proof, and the tutor argued "0" vs 0 three times anyway.
  worksAlready: {
    code: DIFF, run: DIFF_RUN,
    turns: [
      { check: true },
      { say: "wtf" },
      { say: "my output literally says The difference is 0." },
      { say: "wtf???" },
    ],
    expect: "First reply says it works (the output proves it) — no \"0\"-vs-0 critique; 'wtf' gets a check-in; once the learner points at the output, no nitpick is raised or repeated.",
  },
  cramming: {
    code: CRAM, run: CRAM_RUN,
    turns: [{ say: "alright, notice now the cramming of the l;ine in output (can u see poutput?) can I add print() ? is that best practice?" }],
    expect: "Confirms it sees the output and names what's crammed (both prompts and the result on one line); explains it from that output, not an invented cause; print() after the inputs is a fine fix.",
  },
  fstringError: {
    code: FSTR, run: FSTR_RUN,
    turns: [{ say: "oops what happened w my newest?" }],
    expect: "Reads the real SyntaxError on the last line; points at `f(` — the f belongs directly before the opening quote, and the string's closing quote is missing; no self-contradiction; describes rather than pastes a fix.",
  },
  // No run attached: the right answer needs the code actually run (the
  // run-the-code tool), not predicted.
  wordInput: {
    code: CRAM,
    turns: [{ say: "what happens if someone types thirty instead of 30 for the first age?" }],
    expect: "Crash with a ValueError at the first float(input(...)) — ideally checked by running it with ['thirty', ...].",
  },
  predictOutput: {
    code: CRAM,
    turns: [{ say: "what will it print if i put in 30 and 25?" }],
    expect: "Exactly `5.0` after the two prompts — checked by running, not guessed.",
  },
  quotesNoRun: {
    code: DIFF,
    turns: [{ say: "if both ages are 8, will the output show quotes around the 0?" }],
    expect: "No quotes: `The difference is 0.` — the question the tutor got wrong live, now with no run record to lean on.",
  },
  repeatMiss: {
    code: OFF_BY_ONE, run: OFF_BY_ONE_RUN,
    turns: [{ check: true }, { say: "idk" }, { say: "idk still" }],
    expect: "Guiding question first; on repeat misses, names the concept or walks an example instead of rephrasing the same question. No pasted fix.",
  },
  definition: {
    code: WORKING,
    turns: [{ say: "what's a decorator?" }],
    expect: "Short direct explanation, not a Socratic question.",
  },
  workingCode: {
    code: WORKING,
    turns: [{ check: true }],
    expect: "One short line saying it looks fine; at most one optional thought. No inventory.",
  },
  staleClaim: {
    code: AGE,
    seed: [
      ["user", "Check my code"],
      ["assistant", "You have two versions of `agecompare` defined. Which one do you want Python to use?"],
    ],
    turns: [{ say: "no i dont, theres only one. look again" }],
    expect: "Admits the earlier claim was wrong; does not repeat it.",
  },
  codeFixed: {
    code: AGE,
    turns: [{ check: true }, { check: true, code: AGE_FIXED }],
    expect: "Second check reflects the new code; does not repeat the first observation.",
  },
  meta: {
    code: AGE,
    turns: [{ say: "do you save my conversations somewhere?" }],
    expect: "Says it has no visibility into that; does not guess.",
  },
};


async function ask(messages, content, code) {
  const tools = process.env.TOOLS === "off" ? {} : tutorTools({ filename: "main.py", code });
  for (let attempt = 0; attempt < 6; attempt++) {
    let text = "";
    const runs = [];
    for await (const e of chat({ ...tools, systemPrompt: instructions, history: messages, userContent: content, baseUrl: provider.baseUrl, apiKey: provider.apiKey, model, providerLabel: provider.preset })) {
      if (e.type === "text") text += e.text;
      if (e.type === "tool") runs.push(JSON.stringify(e.args.inputs ?? []));
    }
    if (!/^(Rate limit reached|Couldn't reach)/.test(text)) return { text: text.trim(), runs };
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  throw new Error("rate-limited repeatedly");
}

const words = (s) => new Set(s.toLowerCase().match(/[a-z0-9_]+/g) ?? []);
function similarity(a, b) {
  const A = words(a), B = words(b);
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / Math.max(1, A.size + B.size - inter);
}

const firstLine = (s) => s.split(/\n|(?<=[.?!])\s/)[0];

const SAID_NEW = /\b(i'?m new|im new|beginner|what'?s an? |whats an? )/i;
const JARGON = /\b(caller|inconsisten\w*|return (value|type)s?|data types?|types? (is|are|of))\b/i;

function checks(reply, earlier, beginner) {
  const flags = [];
  if (beginner && JARGON.test(reply)) flags.push(`jargon:${reply.match(JARGON)[0]}`);
  if (earlier.includes(reply)) flags.push("VERBATIM-REPEAT");
  else if (earlier.some((e) => similarity(e, reply) > 0.7)) flags.push("near-repeat");
  // Same opening observation re-worded — how the confusion bug looks once
  // exact repeats are gone.
  else if (earlier.length && similarity(firstLine(earlier.at(-1)), firstLine(reply)) > 0.5) flags.push("same-point");
  if (reply.includes("```")) flags.push("code-block");
  const q = (reply.match(/\?/g) ?? []).length;
  if (q > 1) flags.push(`${q}-questions`);
  if (/^(sure|of course|great|certainly|absolutely|let's|let me)\b/i.test(reply)) flags.push("throat-clearing");
  return flags;
}

async function runScenario(s) {
  const display = (s.seed ?? []).map(([role, content]) => ({ role, content }));
  const out = [];
  let code = s.code;
  let beginner = (s.seed ?? []).some(([role, text]) => role === "user" && SAID_NEW.test(text));
  let previousCode = s.seed ? s.code : null; // seeded turns were sent with the scenario's starting code
  for (const t of s.turns) {
    if (t.code) code = t.code;
    const shown = t.check ? "Check my code" : t.say;
    const history = display.slice(-HISTORY_KEEP);
    const content = buildUserContent({ trigger: t.check ? "check" : "manual", question: t.say, filename: "main.py", code, previousCode, runContext: s.run });
    const { text: reply, runs } = await ask(history, content, code);
    previousCode = code;
    const earlier = display.filter((m) => m.role === "assistant").map((m) => m.content);
    beginner ||= SAID_NEW.test(t.say ?? "");
    out.push({ user: shown, reply, runs, flags: checks(reply, earlier, beginner) });
    display.push({ role: "user", content: shown }, { role: "assistant", content: reply });
  }
  return out;
}

const trials = Number(process.argv[2] || 2);
const names = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(SCENARIOS);
const report = [`# Tutor scenarios — ${model} — ${new Date().toISOString()}`, ""];
let flagged = 0, total = 0;

for (const name of names) {
  const s = SCENARIOS[name];
  if (!s) throw new Error(`unknown scenario ${name}`);
  report.push(`## ${name}`, `Expect: ${s.expect}`, "");
  for (let t = 1; t <= trials; t++) {
    report.push(`### trial ${t}`);
    for (const x of await runScenario(s)) {
      total++;
      if (x.flags.length) flagged++;
      report.push(`> **learner:** ${x.user}`, "", ...(x.runs.length ? [`_(ran privately with inputs: ${x.runs.join(", ")})_`, ""] : []), x.reply, x.flags.length ? `\n\`[${x.flags.join(", ")}]\`` : "", "");
    }
    console.log(`${name} trial ${t} done`);
  }
}

report.splice(1, 0, `Replies with a mechanical flag: ${flagged}/${total}`);
const dir = path.join(__dirname, "results");
await mkdir(dir, { recursive: true });
const file = path.join(dir, `scenarios-${model}-${Date.now()}.md`);
await writeFile(file, report.join("\n"));
console.log(`\nflagged ${flagged}/${total} — report: ${file}`);
