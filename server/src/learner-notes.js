// The tutor's memory of this learner across sessions, shown to the learner in
// Settings (read, edit, pin, clear). Lives in the data folder next to
// settings.json, so it survives reinstalls.
//
// Format (plain text the learner can edit):
//   About them:
//   - New to coding.
//   * Knows Java.            <- "*" = pinned by the learner; never changed by the tutor
//
//   Working on now:
//   - Stuck on the loop's stopping point.
//
// Design history, each step measured with simulated learners:
// - A separate request after each reply, not a tool the tutor may call:
//   offered as an optional tool, the model never used it (0/15 runs).
// - Evidence-grounded (quote-grounded memory research): free-text notes
//   over-credited learners in 5/12 sessions. Every change must quote the
//   learner's own words, checked in code (groundNotes).
// - Update, don't delete (Mem0's ADD/UPDATE/DELETE/NOOP; Zep invalidates
//   rather than deletes): a returning learner's stale "new to coding" was
//   removed and nothing replaced it. Changes are updates; replaced lines go to
//   a history file so any change can be undone.
// - Stable vs volatile (CAPTURE: overwriting a stable profile fact needs
//   repeated evidence): notes churned mid-session. "About them" changes only
//   on a first-person statement or the same change proposed twice; "Working
//   on now" may change freely and is cleared at the start of each session.
// - Verified progress: a code line the learner wrote themselves (new in their
//   edit, never shown by the tutor) can back a note about what they fixed.
import { readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { TUTOR_DIR } from "./paths.js";

const NOTES_PATH = path.join(TUTOR_DIR, "learner-notes.md");
const HISTORY_PATH = path.join(TUTOR_DIR, "learner-notes-history.md");
export const NOTES_MAX = 1200;
const ABOUT_LINES = 8;
const NOW_LINES = 4;
const HEAD = { about: "About them:", now: "Working on now:" };

export async function getLearnerNotes() {
  try { return (await readFile(NOTES_PATH, "utf-8")).trim(); } catch { return ""; }
}

export async function setLearnerNotes(text) {
  const notes = String(text ?? "").trim().slice(0, NOTES_MAX);
  await writeFile(NOTES_PATH, notes);
  return notes;
}

export async function getNotesHistory(limit = 30) {
  try { return (await readFile(HISTORY_PATH, "utf-8")).trim().split("\n").slice(-limit); } catch { return []; }
}

async function recordHistory(changes) {
  if (!changes.length) return;
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  await appendFile(HISTORY_PATH, changes.map((c) => `${stamp}  ${c}\n`).join("")).catch(() => {});
}

// ---- parse / format -------------------------------------------------------

// Lines keep their "*" (pinned) marker; "- " bullets are stripped. Notes from
// before sections existed (plain lines, no headers) count as "About them".
export function parseNotes(text) {
  const out = { about: [], now: [] };
  let section = "about";
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^about( them)?:?$/i.test(line)) { section = "about"; continue; }
    if (/^working on( now)?:?$/i.test(line)) { section = "now"; continue; }
    const pinned = line.startsWith("*");
    const body = line.replace(/^[*\-•]\s*/, "").trim();
    if (body) out[section].push(pinned ? `* ${body}` : body);
  }
  return out;
}

export function formatNotes({ about, now }) {
  const block = (head, lines) => (lines.length ? [head, ...lines.map((l) => (l.startsWith("* ") ? l : `- ${l}`))].join("\n") : "");
  return [block(HEAD.about, about), block(HEAD.now, now)].filter(Boolean).join("\n\n");
}

const isPinned = (l) => l.startsWith("* ");
const bodyOf = (l) => l.replace(/^\*\s*/, "");

// ---- grounding --------------------------------------------------------------

const REVISE_PROMPT = `You keep a coding tutor's short private notes about one learner, carried between sessions so the tutor can adapt. The notes have two sections:
- about: lasting facts — what the learner said about themselves ("I'm new to coding", "I know Java"), a confusion they stated in their own words that matters beyond today, something they showed they can now do.
- now: what they're working on or stuck on in this session.

A note may only record what the learner's OWN WORDS or OWN CODE show. Never record: anything the tutor explained; mood, tone or swearing; motives or personality; one-off questions; facts about programming; that they did something "on their own" (the code check below is the only way to show that).

Reply with ONLY a JSON object:
{"add": [{"section": "about" or "now", "note": "short third-person note", "evidence": "the learner's exact words, copied verbatim", "code_evidence": "optional: one line the learner newly wrote in their own code"}],
 "update": [{"old": "an existing note line", "new": "the corrected line", "evidence": "the learner's exact words"}],
 "remove": [{"note": "an existing 'now' line that no longer applies", "evidence": "the learner's exact words"}]}
Prefer "update" over removing: when something changed ("I'm not new anymore"), rewrite the old line into what's true now. Lines starting with "*" are pinned by the learner — never touch them. Most exchanges change nothing: use empty lists. Evidence is copied exactly from a Learner line — never from the Tutor.`;

const normalize = (s) => String(s ?? "").toLowerCase().replace(/[“”"'`’]/g, "").replace(/\s+/g, " ").trim();
const JUDGMENT = /\b(on (?:their|his|her) own|by themselves|without (?:help|being told|prompting)|independently|figured (?:it |this |that )?out|wants? to|prefer\w*|seems?|likes to|enjoys?|frustrat\w*|impatien\w*|motivat\w*|attitude|curious|confident|eager)\b/i;
const QUESTION_ONLY = /^(?:the )?(?:learner |they )?(?:asked|wanted to know|wondered)\b/i;
// A statement about themselves ("I'm not new anymore", "I know Java") — not
// just any sentence containing "I" ("do I need +=?" is a question, not a fact).
const SELF_STATEMENT = /(^|[^a-z])(im|i am|ive|i have|i know|i dont know|i can|i cant|i used to|i write|i work|i study|i learned|i learn|i understand|i get it now|i got it|my background|my job|my first|my class)([^a-z]|$)/;
const STOP = new Set("a an the to of in on at for and or but is are was were be it its this that they them their he she his her with as by from like so not no do does did what how when why".split(" "));
const words = (s) => new Set((normalize(s).match(/[a-z0-9_]+/g) ?? []).filter((w) => !STOP.has(w)));
function overlap(a, b) {
  const A = words(a), B = words(b);
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / Math.max(1, A.size, B.size);
}
const codeLines = (code) => new Set(String(code ?? "").split("\n").map((l) => normalize(l)).filter((l) => l.length >= 4));

// Pure and exported so the rules can be tested without a model.
//   exchanges: oldest-first [{learner, tutor}]; the last is the one just finished
//   code / previousCode: the learner's file now and at their previous message
//   state: { pending: Map } — carries the "same change proposed twice" check
//          for About-them lines across calls (one per server process)
export function groundNotes({ notes, proposal, exchanges, code, previousCode, state = { pending: new Map() } }) {
  const n = parseNotes(notes);
  const dropped = [];
  const changes = []; // for the history file
  const drop = (entry, action, why) => dropped.push({ ...entry, action, why });

  const textEvidence = (ev) => {
    const e = normalize(ev);
    if (e.length < 3) return "no evidence";
    const at = exchanges.findIndex((x) => normalize(x.learner).includes(e));
    if (at === -1) return "evidence isn't the learner's words";
    if (e.length >= 6 && exchanges.slice(0, at).some((x) => normalize(x.tutor).includes(e))) return "evidence just repeats the tutor";
    return null;
  };
  // A line the learner wrote this turn, that no tutor reply ever showed them.
  const codeEvidence = (line) => {
    const l = normalize(line);
    if (l.length < 4) return "no code evidence";
    if (!codeLines(code).has(l)) return "code evidence isn't in their file";
    if (codeLines(previousCode).has(l)) return "code evidence isn't new in this edit";
    if (exchanges.some((x) => normalize(x.tutor).includes(l))) return "code evidence was shown by the tutor";
    return null;
  };
  const noteProblem = (note) => {
    if (!note) return "empty";
    if (/^[*\-•]/.test(note)) return "starts with a list or pin marker"; // only the learner pins (callers strip these first)
    if (JUDGMENT.test(note)) return "a verdict about motive, mood or doing it alone";
    if (QUESTION_ONLY.test(note)) return "just a question they asked";
    return null;
  };
  const find = (section, text) => {
    const t = normalize(bodyOf(String(text ?? "")));
    return n[section].findIndex((l) => normalize(bodyOf(l)) === t) !== -1
      ? n[section].findIndex((l) => normalize(bodyOf(l)) === t)
      : n[section].findIndex((l) => t.length > 8 && normalize(bodyOf(l)).includes(t));
  };
  // About-them lines are stable: they change on a first-person statement, or
  // when the same change is proposed a second time (in a later exchange).
  const aboutChangeAllowed = (key, evidence) => {
    if (SELF_STATEMENT.test(normalize(evidence))) return true;
    const k = normalize(key);
    if (state.pending.has(k)) { state.pending.delete(k); return true; }
    state.pending.set(k, true);
    return false;
  };

  let aboutChanges = 0;
  for (const u of Array.isArray(proposal?.update) ? proposal.update : []) {
    const neu = String(u?.new ?? "").replace(/^[*\-•\s]+/, "").trim();
    const why = noteProblem(neu) ?? textEvidence(u?.evidence);
    let section = "about", i = find("about", u?.old);
    if (i === -1) { section = "now"; i = find("now", u?.old); }
    if (why || i === -1) { drop(u, "update", why ?? "no such note"); continue; }
    if (isPinned(n[section][i])) { drop(u, "update", "pinned by the learner"); continue; }
    if (section === "about") {
      if (aboutChanges >= 1) { drop(u, "update", "one About-them change per update"); continue; }
      if (!aboutChangeAllowed(n.about[i], u.evidence)) { drop(u, "update", "About-them changes need a first-person statement or a second sign"); continue; }
      aboutChanges++;
    }
    changes.push(`replaced: ${bodyOf(n[section][i])}  →  ${neu}`);
    n[section][i] = neu;
  }

  for (const r of Array.isArray(proposal?.remove) ? proposal.remove : []) {
    const why = textEvidence(r?.evidence);
    const i = find("now", r?.note);
    if (why || i === -1) {
      // An About-them line can't just be deleted by the tutor — rewrite it
      // (update) or the learner clears it in Settings.
      drop(r, "remove", why ?? (find("about", r?.note) !== -1 ? "About-them lines are updated, not deleted" : "no such note"));
      continue;
    }
    if (isPinned(n.now[i])) { drop(r, "remove", "pinned by the learner"); continue; }
    changes.push(`removed: ${bodyOf(n.now[i])}`);
    n.now.splice(i, 1);
  }

  for (const a of Array.isArray(proposal?.add) ? proposal.add : []) {
    const note = String(a?.note ?? "").replace(/^[*\-•\s]+/, "").trim();
    const section = a?.section === "now" ? "now" : "about";
    let why = noteProblem(note);
    if (!why) {
      const tWhy = a?.evidence ? textEvidence(a.evidence) : "no evidence";
      const cWhy = a?.code_evidence ? codeEvidence(a.code_evidence) : "no code evidence";
      if (tWhy && cWhy) why = a?.code_evidence ? cWhy : tWhy;
    }
    if (why) { drop(a, "add", why); continue; }
    const similar = n[section].findIndex((l) => !isPinned(l) && overlap(bodyOf(l), note) >= 0.5);
    if (similar !== -1) {
      if (section === "about" && aboutChanges >= 1) { drop(a, "add", "one About-them change per update"); continue; }
      if (section === "about") aboutChanges++;
      changes.push(`replaced: ${bodyOf(n[section][similar])}  →  ${note}`);
      n[section][similar] = note;
    } else {
      n[section].push(note);
      changes.push(`added (${section}): ${note}`);
    }
  }

  // Oldest unpinned lines go first when a section is full.
  const trim = (section, max) => {
    while (n[section].length > max) {
      const i = n[section].findIndex((l) => !isPinned(l));
      if (i === -1) break;
      changes.push(`dropped (full): ${n[section][i]}`);
      n[section].splice(i, 1);
    }
  };
  trim("about", ABOUT_LINES);
  trim("now", NOW_LINES);
  let text = formatNotes(n);
  while (text.length > NOTES_MAX && n.about.some((l) => !isPinned(l))) {
    n.about.splice(n.about.findIndex((l) => !isPinned(l)), 1);
    text = formatNotes(n);
  }
  return { notes: text, dropped, changes };
}

// A new session (the app was restarted): "Working on now" is from last time,
// so it's cleared — kept in the history file, not the notes.
export function startSession(notes) {
  const n = parseNotes(notes);
  const cleared = n.now.filter((l) => !isPinned(l));
  n.now = n.now.filter(isPinned);
  return { notes: formatNotes(n), changes: cleared.map((l) => `cleared at new session: ${l}`) };
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

function addedLines(code, previousCode) {
  const before = codeLines(previousCode);
  return String(code ?? "").split("\n").map((l) => l.trimEnd()).filter((l) => normalize(l).length >= 4 && !before.has(normalize(l)));
}

export async function reviseLearnerNotes({ notes, exchanges, code, previousCode, state, baseUrl, apiKey, model }) {
  const transcript = exchanges.map((x) => `Learner: ${x.learner}\nTutor: ${x.tutor}`).join("\n\n");
  const added = previousCode != null ? addedLines(code, previousCode) : [];
  const codePart = added.length ? `\n\nLines the learner newly wrote in their own code this turn:\n${added.join("\n")}` : "";
  const request = (jsonMode) => fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: REVISE_PROMPT },
        { role: "user", content: `Current notes:\n${notes || "(none yet)"}\n\nLast exchanges, oldest first:\n${transcript}${codePart}` },
      ],
    }),
  });
  // JSON mode isn't supported by every OpenAI-compatible provider or model;
  // one that rejects it (400/404/422) gets the same request without it.
  let res = await request(true);
  if ([400, 404, 422].includes(res.status)) res = await request(false);
  if (!res.ok) return null; // rate limit or outage — just skip this update
  const proposal = parseProposal((await res.json()).choices?.[0]?.message?.content);
  if (!proposal) return null;
  return groundNotes({ notes, proposal, exchanges, code, previousCode, state });
}

export { recordHistory };
