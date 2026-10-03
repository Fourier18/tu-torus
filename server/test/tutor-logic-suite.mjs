// Logic suite: does the tutor get syntax rules right, and hold the truth
// when a learner pushes back? Built after live sessions where the tutor
// said JSON allows trailing commas in arrays, then agreed a comma between
// items was invalid, and guessed at commas/parentheses in a loop.
//
// Ground truth comes from the app's own runtimes, not from a model: every
// snippet is run through runOnce() first, and "does it run?" plus the real
// error text is what the tutor's claims are graded against.
//
// Each case is played by two simulated learners (a beginner and a skeptic).
// Turn 1 asks about the rule; turn 2 pushes back with the OPPOSITE of the
// truth. Grading (judges.mjs, calibrated against independent labels with
// judge-calibration.mjs): first answer right and truth held — grader, kappa
// 1.00; false facts — grader, statement by statement, kappa 0.54, so
// advisory only; nudge endings — mechanical check, exact; "I ran it" with no
// run, and claims about output or errors against the real run —
// claim-check.mjs, mechanical candidates to read.
//
// usage: node server/test/tutor-logic-suite.mjs [label]
//   CASES_FILE=cases/heldout/<file>.mjs  run another set of cases (default: logic-cases.mjs)
//   REPEAT=3                             each conversation N times; rates get 95% intervals
//   ONLY=rb:keyword,js:operator          only those cases
//   TOOLS=off                            without the private run tool
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chat } from "../src/providers/openai-compatible.js";
import { buildUserContent, buildSystemPrompt, tutorTools } from "../src/tutor.js";
import { runIt, record } from "./run-case.mjs";
import { loadProvider } from "./test-provider.mjs";
import { PERSONAS, pushback } from "./logic-cases.mjs";
import { JUDGE_V2, endsWithOffer } from "./judges.mjs";
import { createReplyTidier } from "../src/reply-tidy.js";
import { check, conversations, tally } from "./claim-check.mjs";

// What the learner sees: the server tidies each reply (reply-tidy.js).
const seen = (text) => { const t = createReplyTidier(); return t.push(text) + t.end(); };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const provider = await loadProvider(); // test-provider.mjs (TUTOR_API_KEY when the app's key is encrypted)
const model = process.env.MODEL || provider.model;
const instructions = await readFile(path.join(__dirname, "..", "src", "tutor-instructions.md"), "utf-8");
const label = process.argv[2] || "run";
const casesFile = process.env.CASES_FILE ? path.resolve(__dirname, process.env.CASES_FILE) : path.join(__dirname, "logic-cases.mjs");
const { CASES } = await import(pathToFileURL(casesFile).href);
const REPEAT = Math.max(1, Number(process.env.REPEAT) || 1);



// `toolset` as the app passes it (the private run tool); `ran` collects its
// uses and `fell` the answers made without the tool (chat()'s fallback) —
// from the attempt that answered only: a run in an attempt that then hit a
// rate limit isn't behind the reply.
async function complete(systemPrompt, history, userContent, toolset = {}, ran = [], fell = []) {
  for (let attempt = 0; attempt < 15; attempt++) { // rate limits come back as notices; suites share one limit
    let text = "";
    let notice = false;
    const tried = [], fallbacks = [];
    for await (const e of chat({ ...toolset, systemPrompt, history, userContent, baseUrl: provider.baseUrl, apiKey: provider.apiKey, model, providerLabel: provider.preset })) {
      if (e.type === "text") text += e.text;
      if (e.notice) notice = true; // the app's own message (rate limit, timeout…): try again
      if (e.type === "tool") tried.push(e.name);
      if (e.type === "fallback") fallbacks.push(e.reason);
    }
    if (text.trim() && !notice) { ran.push(...tried); fell.push(...fallbacks); return text.trim(); }
    await new Promise((r) => setTimeout(r, Math.min(5000 * (attempt + 1), 30000)));
  }
  throw new Error("rate-limited repeatedly");
}
const parse = (g) => { try { return JSON.parse(g.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, "$1")); } catch { return null; } };

// Wilson score interval, 95%: where the true rate plausibly lies given k of n.
function wilson(k, n) {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / d, half = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return { rate: +(100 * p).toFixed(1), low: +(100 * Math.max(0, centre - half)).toFixed(1), high: +(100 * Math.min(1, centre + half)).toFixed(1) };
}

const results = [];
const ONLY = process.env.ONLY?.split(",");
for (const c of CASES.filter((c) => !ONLY || ONLY.includes(`${c.ext}:${c.kind}`))) {
  const truth = await runIt(c.ext, c.code, c.inputs);
  // A long error keeps its start and its end: Python puts the message last
  // (after the traceback), Node first (before the stack and its version
  // line). Keeping only the start once hid Python's message from the grader.
  const err = String(truth.error || truth.output);
  const errText = err.length > 700 ? `${err.slice(0, 350)} … ${err.slice(-350)}` : err;
  const truthText = (truth.ok ? `The code RUNS without error. Output: ${JSON.stringify(truth.output.slice(0, 300))}` : `The code FAILS. Error: ${JSON.stringify(errText)}`) + (c.note ? `\nNOTE: ${c.note}` : "");
  for (let rep = 0; rep < REPEAT; rep++) for (const p of PERSONAS) {
    const filename = `main.${c.ext}`;
    const toolset = process.env.TOOLS === "off" ? {} : tutorTools({ filename, code: c.code, runAttached: Boolean(c.run), runFailed: Boolean(c.run) && !truth.ok });
    const systemPrompt = buildSystemPrompt(instructions, toolset);
    const ran = [], fell = [];
    const runContext = c.run ? record(c.ext, c.code, truth) : "";
    const q1 = p.ask(c.q);
    const u1 = buildUserContent({ trigger: "manual", question: q1, filename, code: c.code, previousCode: null, runContext });
    const raw1 = await complete(systemPrompt, [], u1, toolset, ran, fell);
    const r1 = seen(raw1);
    const ran1 = ran.length, fell1 = fell.length;
    const q2 = pushback(truth.ok, p.name);
    const u2 = buildUserContent({ trigger: "manual", question: q2, filename, code: c.code, previousCode: c.code, runContext });
    const raw2 = await complete(systemPrompt, [{ role: "user", content: q1 }, { role: "assistant", content: r1 }], u2, toolset, ran, fell);
    const r2 = seen(raw2);
    const transcript = `FILE ${filename}:\n${c.code}\nTRUTH: ${truthText}\n\nLEARNER: ${q1}\nTUTOR: ${r1}\n\nLEARNER (pushback, the opposite of the truth): ${q2}\nTUTOR: ${r2}`;
    let g = null;
    for (let i = 0; i < 3 && !g; i++) g = parse(await complete(JUDGE_V2, [], transcript));
    const falseFacts = (g?.statements ?? []).filter((s) => s.true === false).map((s) => s.text);
    const grade = { first_correct: !!g?.first_correct, held_truth: !!g?.held_truth, false_facts: falseFacts, offer_ending: endsWithOffer(r1) || endsWithOffer(r2), nudge_trimmed: endsWithOffer(raw1) || endsWithOffer(raw2), why: g?.why ?? "grader failed" };
    const result = { kind: c.kind, ext: c.ext, q: c.q, code: c.code, truth: truthText, persona: p.name, rep, valid: truth.ok, ran: ran.length, ran_turns: [ran1, ran.length - ran1], fallback_turns: [fell1, fell.length - fell1], r1, q2, r2, grade };
    result.claims = check(conversations([result])[0]).map(({ turn, kind, s }) => ({ turn, kind, s }));
    results.push(result);
    process.stdout.write(`${c.ext.padEnd(4)} ${c.kind.padEnd(8)} ${p.name.padEnd(8)}${REPEAT > 1 ? ` #${rep + 1}` : ""} first:${grade.first_correct ? "ok " : "BAD"} held:${grade.held_truth ? "ok " : "BAD"}${falseFacts.length ? " false-facts?" : ""}${grade.offer_ending ? " nudge" : ""}${ran.length ? ` ran:${ran.length}` : ""}${fell.length ? " no-tool" : ""}${result.claims.length ? ` claims:${result.claims.map((x) => x.kind).join(",")}` : ""}\n`);
  }
}

const n = results.length;
const count = (f) => results.filter(f).length;
const summary = {
  label, model, cases_file: path.basename(casesFile), cases: new Set(results.map((r) => `${r.ext}:${r.kind}:${r.q}`)).size, repeat: REPEAT, conversations: n,
  first_correct: { count: count((r) => r.grade.first_correct), ...wilson(count((r) => r.grade.first_correct), n) },
  held_truth: { count: count((r) => r.grade.held_truth), ...wilson(count((r) => r.grade.held_truth), n) },
  false_facts_advisory: count((r) => r.grade.false_facts.length),
  nudge_endings: count((r) => r.grade.offer_ending), // after the server's trim (what the learner sees)
  nudges_trimmed: count((r) => r.grade.nudge_trimmed), // before it
  used_run: count((r) => r.ran),
  answered_without_tool: count((r) => r.fallback_turns.some(Boolean)), // chat()'s fallback
  claims_mechanical: tally(results), // claim-check.mjs: "I ran it" without a run, output, runs/fails
};
const dir = path.join(__dirname, "results");
await mkdir(dir, { recursive: true });
const stamp = Date.now();
await writeFile(path.join(dir, `logic-suite-${label}-${stamp}.json`), JSON.stringify({ summary, results }, null, 2));
const md = [`# Logic suite — ${label} — ${model} — ${new Date().toISOString()}`, "", "```", JSON.stringify(summary, null, 2), "```", ""];
for (const r of results.filter((r) => !r.grade.first_correct || !r.grade.held_truth || r.grade.false_facts.length || r.grade.offer_ending || r.claims.length)) {
  md.push(`## ${r.ext} ${r.kind} (${r.persona}${REPEAT > 1 ? ` #${r.rep + 1}` : ""}) — code ${r.valid ? "runs" : "fails"}`, `**Q:** ${r.q}`, "", r.r1, "", `**Pushback:** ${r.q2}`, "", r.r2, "", `**Grade:** ${JSON.stringify(r.grade)}`, "");
  if (r.claims.length) md.push(`**Claims (mechanical):** ${JSON.stringify(r.claims)} — runs per reply ${JSON.stringify(r.ran_turns)}, answered without the tool ${JSON.stringify(r.fallback_turns)}`, "");
}
await writeFile(path.join(dir, `logic-suite-${label}-${stamp}.md`), md.join("\n"));
console.log("\n" + JSON.stringify(summary));
process.exit(0);
