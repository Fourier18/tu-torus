// Unit checks for groundNotes() — the code-side rules that keep learner notes
// honest, independent of any model. Run: node server/test/learner-notes.test.mjs
import { groundNotes, parseProposal } from "../src/learner-notes.js";

const exchanges = [
  { learner: "why is this only printing 20? this is stupid", tutor: "Look at `total = p`. What happens to the old value?" },
  { learner: "oh im replacing it. do i need += or something", tutor: "Yes — use total += p inside the loop." },
  { learner: "ok total += p worked. i'm new to coding btw", tutor: "Nice, Total: 35." },
];

const cases = [
  ["keeps a note quoting the learner", { add: [{ note: "New to coding.", evidence: "i'm new to coding" }] }, (r) => r.notes === "New to coding."],
  ["drops evidence the learner never wrote", { add: [{ note: "Knows Java.", evidence: "I know Java" }] }, (r) => r.notes === "" && r.dropped[0].why.includes("learner's words")],
  ["drops 'on their own'", { add: [{ note: "Figured out += on their own.", evidence: "do i need += or something" }] }, (r) => r.notes === "" && r.dropped[0].why.includes("verdict")],
  ["drops motive judgments", { add: [{ note: "Wants to understand, not just get answers.", evidence: "why is this only printing 20" }] }, (r) => r.notes === ""],
  ["drops mood notes", { add: [{ note: "Gets frustrated easily.", evidence: "this is stupid" }] }, (r) => r.notes === ""],
  ["drops a quote that repeats the tutor's answer", { add: [{ note: "Uses total += p correctly.", evidence: "total += p" }] }, (r) => r.notes === "" && r.dropped[0].why.includes("repeats the tutor")],
  ["keeps a confusion stated by the learner", { add: [{ note: "Overwrote a running total instead of adding to it.", evidence: "im replacing it" }] }, (r) => r.notes.includes("Overwrote")],
  ["removal needs grounded evidence", { remove: [{ note: "Knows Java; new to Python.", evidence: "i'm new to coding" }] }, (r) => r.notes === "", "Knows Java; new to Python."],
  ["removal without evidence is refused", { remove: [{ note: "Knows Java; new to Python.", evidence: "" }] }, (r) => r.notes === "Knows Java; new to Python.", "Knows Java; new to Python."],
  ["the word like is not a judgment", { add: [{ note: "Thought += works like replacing the value.", evidence: "im replacing it" }] }, (r) => r.notes.startsWith("Thought")],
  ["a bare question is not a note", { add: [{ note: "asked what a decorator is", evidence: "why is this only printing 20" }] }, (r) => r.notes === "" && r.dropped[0].why.includes("question")],
  ["a near-duplicate replaces the older line", { add: [{ note: "Said they are new to coding.", evidence: "i'm new to coding" }] }, (r) => r.notes === "Knows Java; new to Python.\nSaid they are new to coding.", "Knows Java; new to Python.\nIs new to coding."],
  ["different notes that share little stay separate", { add: [{ note: "New to coding.", evidence: "i'm new to coding" }] }, (r) => r.notes === "Knows Java; new to Python.\nNew to coding.", "Knows Java; new to Python."],
  ["notes are capped at 8 lines, oldest dropped", { add: [{ note: "Overwrote a running total.", evidence: "im replacing it" }] }, (r) => r.notes.split("\n").length === 8 && !r.notes.includes("line 1") && r.notes.endsWith("Overwrote a running total."), "line 1 alpha\nline 2 bravo\nline 3 charlie\nline 4 delta\nline 5 echo\nline 6 foxtrot\nline 7 golf\nline 8 hotel"],
  ["only one removal per update", { remove: [{ note: "Knows Java; new to Python.", evidence: "i'm new to coding" }, { note: "Overwrote a running total.", evidence: "im replacing it" }] }, (r) => r.notes === "Overwrote a running total." && r.dropped.some((d) => d.why.includes("one removal")), "Knows Java; new to Python.\nOverwrote a running total."],
  ["preferred is a preference too", { add: [{ note: "Preferred rounding over cents.", evidence: "im replacing it" }] }, (r) => r.notes === ""],
  ["no change keeps notes", { add: [], remove: [] }, (r) => r.notes === "New to coding.", "New to coding."],
  ["garbage proposal is harmless", { add: "nonsense" }, (r) => r.notes === "New to coding.", "New to coding."],
];

const parseCases = [
  ['{"add":[],"remove":[]}', (p) => Array.isArray(p?.add)],
  ['Sure! Here you go:\n```json\n{"add":[{"note":"x","evidence":"y"}],"remove":[]}\n```', (p) => p?.add?.[0]?.note === "x"],
  ["no json here at all", (p) => p === null],
];
let failed = 0;
for (const [text, ok] of parseCases) {
  const pass = ok(parseProposal(text));
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  parseProposal: ${JSON.stringify(text).slice(0, 40)}`);
}
for (const [name, proposal, ok, notes = ""] of cases) {
  const r = groundNotes({ notes, proposal, exchanges });
  const pass = ok(r);
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : `  -> ${JSON.stringify(r)}`}`);
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
