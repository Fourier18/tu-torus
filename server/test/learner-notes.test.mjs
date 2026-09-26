// Unit checks for the code-side rules that keep learner notes honest and
// stable, independent of any model. Run: node server/test/learner-notes.test.mjs
import { groundNotes, parseNotes, formatNotes, startSession, parseProposal } from "../src/learner-notes.js";

const exchanges = [
  { learner: "why is this only printing 20? this is stupid", tutor: "Look at `total = p`. What happens to the old value?" },
  { learner: "oh im replacing it. do i need += or something", tutor: "Yes — use total += p inside the loop." },
  { learner: "ok total += p worked. i'm new to coding btw, and i'm not new to java", tutor: "Nice, Total: 35." },
];
const run = (notes, proposal, extra = {}) => groundNotes({ notes, proposal, exchanges, ...extra });
const about = (r) => parseNotes(r.notes).about;
const now = (r) => parseNotes(r.notes).now;

const cases = [
  // grounding (unchanged rules)
  ["adds a note quoting the learner", () => about(run("", { add: [{ section: "about", note: "New to coding.", evidence: "i'm new to coding" }] })).join() === "New to coding."],
  ["drops evidence the learner never wrote", () => run("", { add: [{ note: "Knows Rust.", evidence: "I know Rust" }] }).notes === ""],
  ["drops 'on their own'", () => run("", { add: [{ note: "Figured out += on their own.", evidence: "do i need += or something" }] }).notes === ""],
  ["drops motives, mood, preferences", () => ["Wants to understand.", "Gets frustrated easily.", "Preferred rounding."].every((note) => run("", { add: [{ note, evidence: "this is stupid" }] }).notes === "")],
  ["drops a quote that repeats the tutor", () => run("", { add: [{ note: "Uses total += p.", evidence: "total += p" }] }).notes === ""],
  ["drops a bare question", () => run("", { add: [{ note: "asked what a decorator is", evidence: "why is this only printing 20" }] }).notes === ""],
  ["'like' is not a judgment", () => about(run("", { add: [{ note: "Thought += works like replacing.", evidence: "im replacing it" }] })).length === 1],
  // sections and format
  ["legacy notes without headers become About them", () => parseNotes("New to coding.\nKnows Java.").about.length === 2],
  ["format round-trips", () => { const t = formatNotes({ about: ["A.", "* B."], now: ["C."] }); const p = parseNotes(t); return p.about.join("|") === "A.|* B." && p.now.join() === "C."; }],
  ["'now' notes go in their own section", () => now(run("", { add: [{ section: "now", note: "Fixing a running total.", evidence: "im replacing it" }] })).length === 1],
  // update, don't delete
  ["About-them lines can't be deleted by the tutor", () => { const r = run("About them:\n- New to coding.", { remove: [{ note: "New to coding.", evidence: "i'm new to coding" }] }); return about(r).join() === "New to coding." && r.dropped[0].why.includes("updated, not deleted"); }],
  ["an update with a first-person statement applies at once", () => { const r = run("About them:\n- New to coding.", { update: [{ old: "New to coding.", new: "Knows Java.", evidence: "i'm not new to java" }] }); return about(r).join() === "Knows Java." && r.changes[0].startsWith("replaced"); }],
  ["an update without a first-person statement needs a second sign", () => {
    const state = { pending: new Map() };
    const u = { old: "Overwrote a running total.", new: "Now adds to a running total.", evidence: "do i need += or something" };
    const first = run("About them:\n- Overwrote a running total.", { update: [u] }, { state });
    const second = run(first.notes, { update: [u] }, { state });
    return about(first).join() === "Overwrote a running total." && about(second).join() === "Now adds to a running total.";
  }],
  ["history shows the learner's words behind a change", () => { const r = run("", { add: [{ section: "about", note: "New to coding.", evidence: "i'm new to coding" }] }); return r.changes[0].includes('(you said: "i\'m new to coding")'); }],
  ["history shows the code line behind a progress note", () => { const r = run("", { add: [{ note: "Fixed the loop bound.", code_evidence: "for i in range(len(nums)):" }] }, { code: "for i in range(len(nums)):", previousCode: "for i in range(len(nums) + 1):" }); return r.changes[0].includes("(you wrote: for i in range(len(nums)):)"); }],
  ["an update to the same text isn't a change", () => { const r = run("About them:\n- is new to coding", { update: [{ old: "is new to coding", new: "is new to coding", evidence: "i'm new to coding" }] }); return about(r).join() === "is new to coding" && r.changes.length === 0; }],
  ["only one About-them change per update", () => { const r = run("About them:\n- A thing.\n- B thing.", { update: [{ old: "A thing.", new: "New to coding.", evidence: "i'm new to coding" }, { old: "B thing.", new: "Knows Java.", evidence: "i'm not new to java" }] }); return about(r).includes("B thing.") && r.dropped.some((d) => d.why.includes("one About-them")); }],
  ["'now' lines can be removed freely", () => now(run("Working on now:\n- Fixing a total.", { remove: [{ note: "Fixing a total.", evidence: "ok total += p worked" }] })).length === 0],
  // pinning
  ["pinned lines can't be updated", () => { const r = run("About them:\n* New to coding.", { update: [{ old: "New to coding.", new: "Knows Java.", evidence: "i'm not new to java" }] }); return about(r).join() === "* New to coding." && r.dropped[0].why.includes("pinned"); }],
  ["pinned lines survive being over capacity", () => { const pinned = "* Pinned fact."; const many = Array.from({ length: 8 }, (_, i) => `- Fact number ${"abcdefgh"[i]}.`); const r = run(`About them:\n${pinned}\n${many.join("\n")}`, { add: [{ note: "New to coding.", evidence: "i'm new to coding" }] }); return about(r).includes(pinned) && about(r).length === 8; }],
  // near-duplicates
  ["a near-duplicate replaces the older line", () => about(run("About them:\n- Knows Java; new to Python.\n- Is new to coding.", { add: [{ note: "Said they are new to coding.", evidence: "i'm new to coding" }] })).join("|") === "Knows Java; new to Python.|Said they are new to coding."],
  ["unrelated notes stay separate", () => about(run("About them:\n- Knows Java; new to Python.", { add: [{ note: "New to coding.", evidence: "i'm new to coding" }] })).length === 2],
  // verified code evidence
  ["a line the learner wrote themselves backs a progress note", () => about(run("", { add: [{ note: "Fixed the loop to stop at the last item.", code_evidence: "for i in range(len(nums)):" }] }, { code: "nums=[1]\nfor i in range(len(nums)):\n    t += nums[i]", previousCode: "nums=[1]\nfor i in range(len(nums) + 1):\n    t += nums[i]" })).length === 1],
  ["code the tutor showed doesn't count", () => run("", { add: [{ note: "Adds to a running total.", code_evidence: "total += p" }] }, { code: "for p in prices:\n    total += p", previousCode: "for p in prices:\n    total = p" }).dropped[0].why.includes("shown by the tutor")],
  ["the Check my code button isn't evidence", () => ["Check my code", "(clicked \"Check my code\")"].every((learner) => ["Check my code", "clicked Check my code", learner].every((evidence) => groundNotes({ notes: "", proposal: { add: [{ note: "Can write an average function.", evidence }] }, exchanges: [{ learner, tutor: "Looks right." }] }).notes === ""))],
  ["a file seen for the first time isn't proof they wrote it", () => run("", { add: [{ note: "Can write an average function.", code_evidence: "return sum(nums) / len(nums)" }] }, { code: "def average(nums):\n    return sum(nums) / len(nums)", previousCode: null }).dropped[0].why.includes("no earlier version")],
  ["code that isn't new this edit doesn't count", () => run("", { add: [{ note: "Wrote a loop.", code_evidence: "for p in prices:" }] }, { code: "for p in prices:\n    total += p", previousCode: "for p in prices:\n    total = p" }).dropped[0].why.includes("isn't new")],
  // sessions
  ["a new session clears 'Working on now' but not pinned or About-them", () => { const s = startSession("About them:\n- New to coding.\n\nWorking on now:\n- Fixing a total.\n* Pinned now."); const p = parseNotes(s.notes); return p.about.join() === "New to coding." && p.now.join() === "* Pinned now." && s.changes.length === 1; }],
  ["the model can't pin a note", () => about(run("", { add: [{ note: "* New to coding.", evidence: "i'm new to coding" }] })).join() === "New to coding."],
  // robustness
  ["no change keeps notes", () => run("About them:\n- New to coding.", { add: [], update: [], remove: [] }).notes === "About them:\n- New to coding."],
  ["garbage proposal is harmless", () => run("About them:\n- New to coding.", { add: "nonsense", update: 5 }).notes === "About them:\n- New to coding."],
  ["parses JSON wrapped in chat and a fence", () => parseProposal('Sure!\n```json\n{"add":[]}\n```')?.add?.length === 0 && parseProposal("nothing") === null],
];

let failed = 0;
for (const [name, test] of cases) {
  let pass = false;
  try { pass = test(); } catch (e) { console.log(`   error: ${e.message}`); }
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
}
console.log(failed ? `${failed} failed` : "all passed");
process.exitCode = failed ? 1 : 0;
