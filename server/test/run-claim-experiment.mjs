// Does the tutor claim runs it never made, and under which set-up? Pushback
// turns from the held-out cases, each answered several ways after the same
// first reply:
//   old-fallback — the tool's note in the prompt, no tool sent (what a
//                  rate-limited request used to become before 1.8.0)
//   tool         — note and tool, answers shown as they come
//   guarded      — note and tool, answers reviewed first (the app since 1.8.0)
//   no-tool      — the no-tool note, no tool (the fallback since 1.8.0)
// Counts replies saying "I ran it" (or "I changed it and ran it") with no
// run in that reply, using claim-check.mjs. Built 2026-10-01 to find the
// cause of 27 such conversations in 116; rerun it for a new provider or
// model (testing plan W8).
//
// usage: node server/test/run-claim-experiment.mjs
//   CONDITIONS=tool,guarded   which set-ups (default: old-fallback,tool,no-tool)
//   N=12 FROM=0               which held-out cases (the runnable ones, in order)
//   REPS=1                    passes over them
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chat } from "../src/providers/openai-compatible.js";
import { buildUserContent, buildSystemPrompt, tutorTools } from "../src/tutor.js";
import { loadProvider } from "./test-provider.mjs";
import { pushback } from "./logic-cases.mjs";
import { check } from "./claim-check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { CASES } = await import(pathToFileURL(path.join(here, "cases", "heldout", "novice-2026-10-01.mjs")).href);
const provider = await loadProvider();
const model = process.env.MODEL || provider.model;
const instructions = await readFile(path.join(here, "..", "src", "tutor-instructions.md"), "utf-8");
const REPS = Number(process.env.REPS) || 1;
const FROM = Number(process.env.FROM) || 0;
const want = (process.env.CONDITIONS || "old-fallback,tool,no-tool").split(",");

async function ask(opts) {
  for (let attempt = 0; attempt < 10; attempt++) {
    let text = "", notice = false, ran = 0, fell = 0;
    for await (const e of chat({ ...opts, baseUrl: provider.baseUrl, apiKey: provider.apiKey, model, providerLabel: provider.preset })) {
      if (e.type === "text") text += e.text;
      if (e.notice) notice = true;
      if (e.type === "tool") ran++;
      if (e.type === "fallback") fell++;
    }
    if (text.trim() && !notice) return { text: text.trim(), ran, fell };
    await new Promise((r) => setTimeout(r, Math.min(3000 * (attempt + 1), 30000)));
  }
  throw new Error("rate-limited repeatedly");
}

const cases = CASES.filter((c) => c.run && c.ext !== "json").slice(FROM, FROM + (Number(process.env.N) || 12));
const tally = Object.fromEntries(want.map((k) => [k, { claims: 0, n: 0, ran: 0, fell: 0 }]));
for (let rep = 0; rep < REPS; rep++) for (const c of cases) {
  const filename = `main.${c.ext}`;
  const toolset = tutorTools({ filename, code: c.code });
  if (!toolset.tools) continue;
  const u1 = buildUserContent({ trigger: "manual", question: c.q, filename, code: c.code, previousCode: null, runContext: "" });
  // One first reply, so the set-ups differ only at the pushback.
  const first = await ask({ ...toolset, systemPrompt: buildSystemPrompt(instructions, toolset), history: [], userContent: u1 });
  const history = [{ role: "user", content: c.q }, { role: "assistant", content: first.text }];
  const u2 = buildUserContent({ trigger: "manual", question: pushback(true, "skeptic"), filename, code: c.code, previousCode: c.code, runContext: "" });
  const base = buildSystemPrompt(instructions, toolset); // with the tool offered: no run note of either kind
  const { review, ...unguarded } = toolset;
  const setups = {
    "old-fallback": { systemPrompt: base + toolset.toolNote },
    tool: { ...unguarded, systemPrompt: base },
    guarded: { ...toolset, systemPrompt: base },
    "no-tool": { systemPrompt: base + toolset.noToolNote },
  };
  for (const name of want) {
    const r = await ask({ ...setups[name], history, userContent: u2 });
    const claims = check({ replies: [r.text], ranTurns: [r.ran], runs: null, output: null }).filter((x) => x.kind === "ran" || x.kind === "changed");
    const t = tally[name];
    t.n++;
    if (claims.length) t.claims++;
    if (r.ran) t.ran++;
    if (r.fell) t.fell++;
    console.log(`${c.ext} ${c.kind} ${name.padEnd(12)} ran:${r.ran} fell:${r.fell}${claims.length ? `  CLAIM: "${claims[0].s.slice(0, 100)}"` : ""}`);
  }
}
console.log("\n" + JSON.stringify({ model, tally }));
process.exit(0);
