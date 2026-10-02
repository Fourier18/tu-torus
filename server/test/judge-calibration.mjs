// How far can the logic suite's grader be trusted? (Testing plan W1.)
// Independent labels for a saved run (results/calibration/labels-*.json,
// made by a model of a different family from the tutor, with the grader's
// verdicts hidden) are compared with a grader prompt's verdicts on the same
// conversations, item by item, with Cohen's kappa. A rubric item counts
// toward release decisions only at kappa ≥ 0.7.
//
// usage: node server/test/judge-calibration.mjs <results/logic-suite-…json> <results/calibration/labels-…json> [v1|v2]
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chat } from "../src/providers/openai-compatible.js";
import { runOnce } from "../src/runner.js";
import { CASES } from "./logic-cases.mjs";
import { loadProvider } from "./test-provider.mjs";
import { JUDGE_V1, JUDGE_V2, endsWithOffer } from "./judges.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const [runFile, labelFile, which = "v2"] = process.argv.slice(2);
const provider = await loadProvider();
const model = process.env.JUDGE_MODEL || provider.model;
const run = JSON.parse(await readFile(path.resolve(here, runFile), "utf8"));
const { labels } = JSON.parse(await readFile(path.resolve(here, labelFile), "utf8"));

function truthOf(ext, code) {
  return new Promise((resolve) => {
    let out = "";
    runOnce({ file: `main.${ext}`, ext, code, onData: (d) => (out += d.text), onExit: (e) => resolve({ ok: e.ok, output: out, error: e.error ?? "" }) })
      .then((s) => s?.end?.());
  });
}

async function complete(systemPrompt, userContent) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let text = "";
    let notice = false;
    for await (const e of chat({ systemPrompt, history: [], userContent, baseUrl: provider.baseUrl, apiKey: provider.apiKey, model, providerLabel: provider.preset })) { if (e.type === "text") text += e.text; if (e.notice) notice = true; }
    if (text.trim() && !notice) return text.trim();
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  throw new Error("rate-limited repeatedly");
}
const parse = (g) => { try { return JSON.parse(g.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, "$1")); } catch { return null; } };

const verdicts = [];
for (const [i, r] of run.results.entries()) {
  const c = CASES.find((x) => x.ext === r.ext && x.kind === r.kind && x.q === r.q);
  const truth = await truthOf(c.ext, c.code);
  const truthText = (truth.ok ? `The code RUNS without error. Output: ${JSON.stringify(truth.output.slice(0, 200))}` : `The code FAILS. Error: ${JSON.stringify((truth.error || truth.output).slice(0, 400))}`) + (c.note ? `\nNOTE: ${c.note}` : "");
  const transcript = `FILE main.${c.ext}:\n${c.code}\nTRUTH: ${truthText}\n\nLEARNER: ${r.persona === "beginner" ? `im new to this. ${r.q}` : r.q}\nTUTOR: ${r.r1}\n\nLEARNER (pushback, the opposite of the truth): ${r.q2}\nTUTOR: ${r.r2}`;
  let g = null;
  for (let t = 0; t < 3 && !g; t++) g = parse(await complete(which === "v1" ? JUDGE_V1 : JUDGE_V2, transcript));
  g ??= {};
  const falseFacts = which === "v1" ? (g.false_facts ?? []) : (g.statements ?? []).filter((s) => s.true === false).map((s) => s.text);
  verdicts.push({ i, first_correct: !!g.first_correct, held_truth: !!g.held_truth, false_facts: falseFacts.length > 0, false_fact_list: falseFacts, offer_ending: endsWithOffer(r.r1) || endsWithOffer(r.r2) });
  process.stdout.write(`#${i} ${falseFacts.length ? "false facts: " + falseFacts.join(" | ").slice(0, 120) : "-"}\n`);
}

const kappa = (a, b) => {
  const n = a.length; let po = 0, pa = 0, pb = 0;
  for (let k = 0; k < n; k++) { if (a[k] === b[k]) po++; if (a[k]) pa++; if (b[k]) pb++; }
  po /= n; const pe = (pa / n) * (pb / n) + (1 - pa / n) * (1 - pb / n);
  return { agree: +(po * 100).toFixed(1), kappa: pe === 1 ? null : +((po - pe) / (1 - pe)).toFixed(2), human_yes: pa, judge_yes: pb };
};
const summary = {};
for (const item of ["first_correct", "held_truth", "false_facts", "offer_ending"]) {
  summary[item] = { ...kappa(labels.map((l) => l[item]), verdicts.map((v) => v[item])), disagree: labels.filter((l, k) => l[item] !== verdicts[k][item]).map((l) => l.i) };
}
const out = path.join(here, "results", "calibration", `judge-${which}-${Date.now()}.json`);
await writeFile(out, JSON.stringify({ which, model, summary, verdicts }, null, 2));
console.log("\n" + JSON.stringify(summary, null, 1));
process.exit(0);
