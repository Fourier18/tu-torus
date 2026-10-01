// Notes evaluation: scripted learner/tutor sessions with known true facts,
// run through the real note-taker (live model), scored on:
//   churn     — how many times the notes changed per session
//   accuracy  — expected facts present at the end
//   retention — facts from earlier sessions still present later
//   forbidden — over-crediting, mood, stale facts that must not appear
// Both sides of each conversation are scripted, so only the note-taker varies.
//
// usage: node server/test/notes-eval.mjs [trials]
//   env: NOTES_IMPL=old  to run the 1.0.5 note-taker (server/test/_notes-1.0.5.mjs,
//        extracted with: git show 77ddd96:server/src/learner-notes.js)
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadProvider } from "./test-provider.mjs";

const OLD = process.env.NOTES_IMPL === "old";
const impl = OLD ? await import("./_notes-1.0.5.mjs") : await import("../src/learner-notes.js");
const provider = await loadProvider(); // test-provider.mjs (TUTOR_API_KEY when the app's key is encrypted)
const model = process.env.MODEL || provider.model;
const WINDOW = 3;

const LOOP_BUG = "nums = [4, 8, 15]\ntotal = 0\nfor i in range(len(nums) + 1):\n    total += nums[i]\nprint(total)\n";
const LOOP_FIXED = LOOP_BUG.replace("range(len(nums) + 1)", "range(len(nums))");

// Each exchange: [learner, tutor, code?]. code = the learner's file at that message.
const PERSONAS = {
  returning: {
    sessions: [
      [["im new to coding. why does nothing show up when i run it?", "Your function returns the answer, but nothing prints it — so the screen stays blank."],
       ["oh so return doesnt print it?", "Right — return hands the value back; print is what shows it."],
       ["got it thanks", "You're welcome."]],
      [["hey im back. im not new anymore, ive been practicing and i write classes now. why does my method print None?", "Your method prints inside itself but returns nothing, so print() shows None."],
       ["ah ok, makes sense", "Great."]],
    ],
    expectEachSession: [[/new to coding/i], [/practic|not new|classes|been coding/i]],
    expect: [/practic|not new|classes|been coding/i],
    forbid: [],
    forbidFinal: [/^[-*]\s*(is\s+)?new to coding\.?$/im], // true in session 1, stale by the end
    retain: [],
  },
  javaDev: {
    sessions: [
      [["i know java but im new to python. why the index error here?", "range(len(nums) + 1) goes one past the end of the list.", LOOP_BUG],
       ["ah, range stops before the end value. got it", "Exactly."]],
      [["whats a dict in python?", "A dict maps keys to values, like a HashMap."],
       ["cool", "Anything else?"]],
    ],
    expectEachSession: [[/java/i]],
    expect: [/java/i],
    forbid: [],
    retain: [/java/i],
  },
  selfFixer: {
    sessions: [
      [["my loop crashes with an index error, why?", "Look at the + 1 in your range — what's the last number it produces?", LOOP_BUG],
       ["i changed the range, does it work now?", "Yes — it prints 27 now.", LOOP_FIXED],
       ["how do i also print the average?", "Use total / len(nums).", LOOP_FIXED],
       ["ok i added total / len(nums) like you said", "Right, that prints 9.0.", LOOP_FIXED + "print(total / len(nums))\n"]],
    ],
    expect: [],
    forbid: [/on (their|his|her) own|figured|by themselves|independently/i, /average.*(own|themselves)/i],
    retain: [],
  },
  moody: {
    sessions: [
      [["wtf this is so stupid why doesnt it work", "Look at line 3 — what does total = p do each time?"],
       ["just give me the damn answer", "Change total = p to total += p."],
       ["ugh fine. whatever", "Try running it."]],
    ],
    expect: [],
    forbid: [/frustrat|angry|annoy|impatien|swear|rude|mood|irritat|stupid|damn/i],
    retain: [],
  },
  churnProbe: {
    sessions: [
      [["why does my while loop never stop?", "What changes i inside the loop?"],
       ["nothing i guess? i thought it goes up by itself", "It doesn't — you have to change it."],
       ["so i have to add 1 to it myself?", "Yes."],
       ["ok but where do i put that", "Inside the loop, after the print."],
       ["oh inside. ok", "Right."],
       ["it stops now", "Great."]],
    ],
    expect: [/loop|variable|by itself|change/i],
    forbid: [],
    retain: [],
  },
};

async function runPersona(p) {
  let notes = "";
  const state = { pending: new Map() };
  const perSession = [];
  for (const [si, session] of p.sessions.entries()) {
    if (!OLD && si > 0) notes = impl.startSession(notes).notes;
    const history = [];
    let previousCode = null;
    let changes = 0;
    for (const [learner, tutor, code] of session) {
      history.push({ learner, tutor });
      let r = null;
      for (let attempt = 0; attempt < 5 && r === null; attempt++) {
        r = await impl.reviseLearnerNotes({ notes, exchanges: history.slice(-WINDOW), code, previousCode, state, baseUrl: provider.baseUrl, apiKey: provider.apiKey, model });
        if (r === null) await new Promise((res) => setTimeout(res, 4000 * (attempt + 1))); // null = rate limit/outage or unparseable
      }
      if (r && r.notes !== notes) { changes++; notes = r.notes; }
      previousCode = code ?? previousCode;
    }
    perSession.push({ notes, changes });
  }
  const final = perSession.at(-1).notes;
  const sessionExpect = (p.expectEachSession ?? []).flatMap((res, i) => res.map((re) => re.test(perSession[i]?.notes ?? "")));
  return {
    final,
    churn: perSession.map((s) => s.changes),
    expectHit: p.expect.filter((re) => re.test(final)).length + sessionExpect.filter(Boolean).length,
    expectTotal: p.expect.length + sessionExpect.length,
    forbidHits: [...p.forbid.filter((re) => re.test(perSession.map((s) => s.notes).join("\n"))), ...(p.forbidFinal ?? []).filter((re) => re.test(final))].map(String),
    retained: p.retain.filter((re) => re.test(final)).length,
    retainTotal: p.retain.length,
  };
}

const trials = Number(process.argv[2] || 2);
const totals = { churn: 0, sessions: 0, expectHit: 0, expectTotal: 0, forbid: 0, retained: 0, retainTotal: 0 };
console.log(`notes implementation: ${OLD ? "1.0.5 (old)" : "current"} — model ${model}\n`);
for (const [name, p] of Object.entries(PERSONAS)) {
  for (let t = 1; t <= trials; t++) {
    const r = await runPersona(p);
    totals.churn += r.churn.reduce((a, b) => a + b, 0); totals.sessions += r.churn.length;
    totals.expectHit += r.expectHit; totals.expectTotal += r.expectTotal;
    totals.forbid += r.forbidHits.length; totals.retained += r.retained; totals.retainTotal += r.retainTotal;
    console.log(`${name} #${t}: churn/session ${JSON.stringify(r.churn)}  expected ${r.expectHit}/${r.expectTotal}  retained ${r.retained}/${r.retainTotal}  forbidden ${r.forbidHits.length ? r.forbidHits.join(" ") : "none"}`);
    console.log(`   final: ${JSON.stringify(r.final)}`);
  }
}
console.log(`\nTOTAL  churn ${totals.churn} over ${totals.sessions} sessions (${(totals.churn / totals.sessions).toFixed(2)}/session)  expected facts ${totals.expectHit}/${totals.expectTotal}  retained ${totals.retained}/${totals.retainTotal}  forbidden hits ${totals.forbid}`);
