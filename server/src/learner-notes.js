// The tutor's memory of this learner across sessions: a short plain-text
// note, kept up to date by the model itself and shown to the learner in
// Settings (read, correct, clear). Lives in the data folder next to
// settings.json, so it survives reinstalls.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TUTOR_DIR } from "./paths.js";

const NOTES_PATH = path.join(TUTOR_DIR, "learner-notes.md");
export const NOTES_MAX = 1200; // forces keeping what matters, not a transcript
const NOTES_LINES = 8;

export async function getLearnerNotes() {
  try { return (await readFile(NOTES_PATH, "utf-8")).trim(); } catch { return ""; }
}

export async function setLearnerNotes(text) {
  const notes = String(text ?? "").trim().slice(0, NOTES_MAX);
  await writeFile(NOTES_PATH, notes);
  return notes;
}

// Updating is a separate short request after each reply, not a tool the tutor
// may call mid-answer: offered as an optional tool, Mistral Large never once
// used it across 15 test runs. Asking every time makes it reliable; the model
// still decides whether anything is worth keeping.
//
// Accuracy: free-text notes over-credited learners in 5 of 12 simulated
// sessions ("figured out += on their own" right after being told it) and
// judged motives ("wants to understand" — of a student trying to cheat). The
// model saw only the latest exchange, so it couldn't tell who solved what.
// Now (following quote-grounded memory work: grounded, verbatim-anchored
// entries stay faithful where free summaries drift): it sees the last few
// exchanges, every added or removed note must quote the learner's own words,
// and groundNotes() below enforces that in code — a quote not found verbatim
// in the learner's messages, a quote that just repeats the tutor, or a
// verdict about doing it "on their own" or about motives/mood is dropped.
const REVISE_PROMPT = `You keep a coding tutor's short private notes about one learner, carried between sessions so the tutor can adapt. You see the current notes and the last few exchanges.

A note may only record what the learner's OWN WORDS show:
- what they said about themselves ("I'm new to coding", "I know Java")
- a confusion or wrong idea they stated ("so return doesn't print it?")
- a correct answer they gave to a question the tutor asked — before the tutor gave that answer

Never record: anything inferred from their code; one-off questions; mood, tone or swearing; motives or personality ("wants to understand", "curious"); whether they did something "on their own" or "figured it out"; what the tutor explained; facts about programming.

Don't add a note that says the same thing as an existing one. Most exchanges change nothing. Reply with ONLY a JSON object:
{"add": [{"note": "short third-person note", "evidence": "the learner's exact words that show it, copied verbatim"}],
 "remove": [{"note": "an existing note line to delete", "evidence": "the learner's exact words that contradict it"}]}
Use empty lists for no change. Evidence must be copied exactly from a Learner line — never from the Tutor.`;

const normalize = (s) => String(s ?? "").toLowerCase().replace(/[“”"'`’]/g, "").replace(/\s+/g, " ").trim();
const JUDGMENT = /\b(on (?:their|his|her) own|by themselves|without (?:help|being told|prompting)|independently|figured (?:it |this |that )?out|wants? to|prefer\w*|seems?|likes to|enjoys?|frustrat\w*|impatien\w*|motivat\w*|attitude|curious|confident|eager)\b/i;

// Pure and exported so it can be tested without a model. `exchanges` is
// oldest-first [{learner, tutor}]; the last one is the exchange just finished.
export function groundNotes({ notes, proposal, exchanges }) {
  const lines = String(notes ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const dropped = [];
  const check = (entry) => {
    const note = String(entry?.note ?? "").trim();
    const ev = normalize(entry?.evidence);
    if (!note) return "empty";
    if (JUDGMENT.test(note)) return "a verdict about motive, mood or doing it alone";
    if (/^(?:the )?(?:learner |they )?(?:asked|wanted to know|wondered)\b/i.test(note)) return "just a question they asked";
    if (ev.length < 3) return "no evidence";
    const at = exchanges.findIndex((x) => normalize(x.learner).includes(ev));
    if (at === -1) return "evidence isn't the learner's words";
    if (ev.length >= 6 && exchanges.slice(0, at).some((x) => normalize(x.tutor).includes(ev))) return "evidence just repeats the tutor";
    return null;
  };
  // Near-duplicates: long sessions piled up four wordings of one point
  // ("wants output to include descriptive text…"). A new note that shares
  // most of its words with an existing line replaces that line instead.
  // Compared on meaningful words only, relative to the longer note — so
  // "Knows Java; new to Python" and "new to coding" stay separate.
  const STOP = new Set("a an the to of in on at for and or but is are was were be it its this that they them their he she his her with as by from like so not no do does did what how when why".split(" "));
  const words = (s) => new Set((normalize(s).match(/[a-z0-9_]+/g) ?? []).filter((w) => !STOP.has(w)));
  const overlap = (a, b) => {
    const A = words(a), B = words(b);
    const inter = [...A].filter((w) => B.has(w)).length;
    return inter / Math.max(1, A.size, B.size);
  };
  let kept = [...lines];
  // At most one removal per update: in long simulated sessions the model
  // cleared every note at once and rewrote them a turn later (flapping). A
  // real correction removes one wrong line; wiping everything is the
  // learner's call, via Settings.
  let removed = 0;
  for (const r of Array.isArray(proposal?.remove) ? proposal.remove : []) {
    if (removed >= 1) { dropped.push({ ...r, action: "remove", why: "only one removal per update" }); continue; }
    const why = check(r);
    const target = kept.find((l) => normalize(l) === normalize(r?.note)) ?? kept.find((l) => normalize(l).includes(normalize(r?.note)) && normalize(r?.note).length > 8);
    if (why || !target) { dropped.push({ ...r, action: "remove", why: why ?? "no such note" }); continue; }
    kept = kept.filter((l) => l !== target);
    removed++;
  }
  for (const a of Array.isArray(proposal?.add) ? proposal.add : []) {
    const why = check(a);
    if (why) { dropped.push({ ...a, action: "add", why }); continue; }
    const note = String(a.note).trim();
    const similar = kept.findIndex((l) => overlap(l, note) >= 0.5);
    if (similar !== -1) kept.splice(similar, 1);
    kept.push(note);
  }
  while (kept.length > NOTES_LINES) kept.shift(); // oldest lines go first
  let text = kept.join("\n");
  while (text.length > NOTES_MAX && kept.length > 1) { kept.shift(); text = kept.join("\n"); }
  return { notes: text.slice(0, NOTES_MAX), dropped };
}

// The model's reply should be a JSON object, but without JSON mode some
// models wrap it in prose or a code fence — take the outermost {...}.
export function parseProposal(text) {
  const s = String(text ?? "");
  try { return JSON.parse(s); } catch { /* fall through */ }
  const start = s.indexOf("{"), end = s.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

export async function reviseLearnerNotes({ notes, exchanges, baseUrl, apiKey, model }) {
  const transcript = exchanges.map((x) => `Learner: ${x.learner}\nTutor: ${x.tutor}`).join("\n\n");
  const request = (jsonMode) => fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: REVISE_PROMPT },
        { role: "user", content: `Current notes:\n${notes || "(none yet)"}\n\nLast exchanges, oldest first:\n${transcript}` },
      ],
    }),
  });
  // JSON mode isn't supported by every OpenAI-compatible provider or model;
  // one that rejects it (400/404/422) gets the same request without it, so
  // notes keep working there instead of silently never updating.
  let res = await request(true);
  if ([400, 404, 422].includes(res.status)) res = await request(false);
  if (!res.ok) return null; // rate limit or outage — just skip this update
  const proposal = parseProposal((await res.json()).choices?.[0]?.message?.content);
  if (!proposal) return null;
  const { notes: next, dropped } = groundNotes({ notes, proposal, exchanges });
  return { notes: next, dropped };
}
