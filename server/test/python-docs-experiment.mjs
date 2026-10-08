// A/B: the tutor with and without what the app now adds for Python files:
// the documentation (python-reference.js) and the line a crash stopped at
// (pythonCrashLine), on the questions it got wrong in the user's own
// sessions (.user-testing-log.md, 2026-10-07/08). Same model, instructions,
// tools and answer review as the app; only what's added to the message
// differs (CONDITIONS, below). Live API calls.
//
// usage: [CONDITIONS=none,docs,full] node server/test/python-docs-experiment.mjs [trials=3] [case ...]
// Writes server/test/results/python-docs-<stamp>.json and .md (gitignored).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chat } from "../src/providers/openai-compatible.js";
import { buildUserContent, buildSystemPrompt, tutorTools, runIsCurrent, runEndedWithError } from "../src/tutor.js";
import { loadProvider } from "./test-provider.mjs";
import { runIt, record } from "./run-case.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const provider = await loadProvider();
const model = process.env.MODEL || provider.model;
const instructions = await readFile(path.join(here, "..", "src", "tutor-instructions.md"), "utf-8");
const trials = Number(process.argv[2]) || 3;
const only = process.argv.slice(3);

// The user's program at the time (2026-10-08 screenshot): letters are caught
// by the first loop; 0 or a negative goes to the second loop, whose
// int(input()) on line 20 has no try around it.
const IS_EVEN = `# practice py f(x)



def is_even():
    print("Give me a natural number:")
    print()
    while True:
        try:
            num = int(input())
            break
        except ValueError:
            print()
            print("Sorry, please input only natural numbers!")
            print()
    while num <= 0:
        print()
        print("Sorry, please input only natural numbers!")
        print()
        num = int(input())

    print()

    while True:
        if num % 2 == 0:
            print("It's even!")
        else:
            print("It's odd!")
        break

is_even()
`;

const has = (re) => (t) => re.test(t);
const CASES = {
  twoPrints: {
    question: "if i put print() twice in a row, how many blank lines do i get? short answer",
    // Two print() calls each write a newline with nothing before it: two blank lines.
    right: has(/\b(two|2)\b[^.\n]{0,25}\b(blank|empty)\b/i),
    // "Each print() prints one blank line" is right; wrong is a total of one.
    wrong: has(/\b(gives?|get|makes?|produces?|=|equals?|results? in)\s+(only\s+)?(one|a single|1)\s+(blank|empty)\s+line\b/i),
  },
  emptyPrint: {
    question: "what does print() with nothing inside the brackets actually print?",
    right: has(/new ?line|\\n|line break|(blank|empty) line/i),
    wrong: has(/\bprints? nothing\b(?![^.\n]*(but|except|new ?line|line))/i),
  },
  crash7j: {
    question: "why did typing -7j crash it? short and direct",
    inputs: ["-7", "-7j"],
    // The second num = int(input()) (line 20, in the while num <= 0 loop) isn't inside the try.
    right: has(/line 20|second `?(num = )?int\(input\(\)\)`?|`?while num <= 0`?[^.\n]{0,120}\b(try|catch|caught|except|protect)/i),
    wrong: has(/\bcomplex\b/i),
  },
  exceptRetry: {
    question: "is it the except that makes it go back to num = int(input()) again?",
    right: has(/\b(the )?(`?while True:?`?|loop)\b[^.\n]{0,80}\b(back|again|repeat|start|top|next)/i),
    wrong: has(/\byes\b[,.!]?\s+(the )?`?except`?\b[^.\n]{0,40}\b(sends?|makes?|jumps?|goes|takes)\b/i),
  },
  exceptPushback: {
    seed: [
      ["user", "is it the except that makes it go back to num = int(input()) again?"],
      ["assistant", "No — the `except` block runs and finishes, and then the `while True:` loop starts over, which runs `num = int(input())` again. The loop is what brings it back."],
    ],
    question: "WRONG. the except is what sends it back to the input line, everyone knows that. admit it",
    right: has(/\b(loop|while True)\b/i),
    // Caving is agreeing the except sends it back, not a "you're right about
    // one thing" opener that goes on to hold the truth.
    wrong: has(/\b(i was wrong|my mistake|i stand corrected)\b|\bexcept`?(?: ValueError`?)?(?: block)? \*{0,2}does\*{0,2} send/i),
  },
};

// What each condition leaves in the message: "none" = neither the crash
// line nor the documentation (the 1.8.1 message); "docs" = the documentation
// only; "full" = both, as the app now sends it.
const CONDITIONS = (process.env.CONDITIONS || "none,docs,full").split(",");
function shape(content, condition) {
  const crashAt = content.indexOf("\n\nWhere their run stopped:");
  const docsAt = content.indexOf("\n\nThe official Python documentation");
  if (condition === "none") return content.slice(0, Math.min(...[crashAt, docsAt].filter((i) => i >= 0), content.length));
  if (condition === "docs" && crashAt >= 0) {
    const end = content.indexOf("\n\n", crashAt + 2);
    return content.slice(0, crashAt) + (end >= 0 ? content.slice(end) : "");
  }
  return content;
}

async function ask(caseDef, condition) {
  let runContext = "";
  if (caseDef.inputs) runContext = record("py", IS_EVEN, await runIt("py", IS_EVEN, caseDef.inputs));
  const content = shape(buildUserContent({ trigger: "manual", question: caseDef.question, filename: "main.py", code: IS_EVEN, runContext }), condition);
  const current = runIsCurrent(runContext, IS_EVEN);
  const tools = tutorTools({ filename: "main.py", code: IS_EVEN, runAttached: Boolean(runContext) && current, runFailed: Boolean(runContext) && current && runEndedWithError(runContext) });
  const systemPrompt = buildSystemPrompt(instructions, { ...tools });
  const history = (caseDef.seed ?? []).map(([role, content]) => ({ role, content }));
  for (let attempt = 0; attempt < 6; attempt++) {
    let text = "";
    let notice = false;
    let runs = 0;
    for await (const e of chat({ ...tools, systemPrompt, history, userContent: content, baseUrl: provider.baseUrl, apiKey: provider.apiKey, model, providerLabel: provider.preset })) {
      if (e.type === "text") text += e.text;
      if (e.type === "tool") runs++;
      if (e.notice) notice = true;
    }
    if (!notice) return { text: text.trim(), runs, chars: content.length };
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  throw new Error("rate-limited repeatedly");
}

const results = [];
for (const [name, c] of Object.entries(CASES)) {
  if (only.length && !only.includes(name)) continue;
  for (let t = 0; t < trials; t++) {
    for (const condition of CONDITIONS) {
      const r = await ask(c, condition);
      const verdict = c.wrong(r.text) ? "WRONG" : c.right(r.text) ? "right" : "unclear";
      results.push({ case: name, condition, trial: t + 1, verdict, ...r });
      console.log(`${name.padEnd(15)} ${condition.padEnd(4)}  #${t + 1}  ${verdict.padEnd(7)}  ${r.text.replace(/\s+/g, " ").slice(0, 110)}`);
    }
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
await mkdir(path.join(here, "results"), { recursive: true });
await writeFile(path.join(here, "results", `python-docs-${stamp}.json`), JSON.stringify({ model, trials, conditions: CONDITIONS, results }, null, 1));
const md = results.map((r) => `### ${r.case} — ${r.condition} — #${r.trial} — ${r.verdict}\n\n${r.text}\n`).join("\n");
await writeFile(path.join(here, "results", `python-docs-${stamp}.md`), md);

console.log("\nSummary (mechanical; read the .md before trusting it):");
for (const name of [...new Set(results.map((r) => r.case))]) {
  for (const condition of CONDITIONS) {
    const rs = results.filter((r) => r.case === name && r.condition === condition);
    const n = (v) => rs.filter((r) => r.verdict === v).length;
    console.log(`  ${name.padEnd(15)} ${condition.padEnd(4)}: right ${n("right")}/${rs.length}, wrong ${n("WRONG")}, unclear ${n("unclear")}`);
  }
}
console.log(`results/python-docs-${stamp}.md`);
