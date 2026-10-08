import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSettings } from "./settings.js";
import { chat } from "./providers/openai-compatible.js";
import { runLearnerCode, runLearnerFile } from "./tools/run-learner-code.js";
import { getLearnerNotes, setLearnerNotes, reviseLearnerNotes, startSession, recordHistory } from "./learner-notes.js";
import { safeRunRecordPath } from "./security.js";
import { LANGUAGES } from "./languages.js";
import { pythonReferenceFor } from "./python-reference.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INSTRUCTIONS_PATH = path.join(__dirname, "tutor-instructions.md");

const PROVIDER_LABELS = { mistral: "Mistral", gemini: "Gemini", openrouter: "OpenRouter" };

// The "check" trigger carries no typed question — this supplies what the
// model is actually being asked to do. Deliberately not a fixed canned
// string: sending identical text on every click put the exact same
// "user: X / assistant: Y" pair in the trimmed history repeatedly, which
// measurably pushed weaker/free-tier models toward regenerating the same
// stale answer instead of re-reading the fresh code block each time.
const TRIGGER_PROMPTS = {
  // Scenario runs had the tutor parrot "the code is fresh to me" from an
  // earlier wording, then walk through every line and end with "What do you
  // want to do next?" — the opposite of "if it works, say so and stop".
  check: "(The learner clicked \"Check my code\".) Judge the code below as it is right now, not by anything you said earlier. If something stops it doing what it's evidently meant to, point at that one thing. If it works, say so in a sentence and stop — no walkthrough of what each line does, no question about what they want next.",
};

// History only carries what the chat panel shows ("Check my code", the
// learner's typed words) — never the code that was sent alongside. Without
// this note the model can't tell whether the code changed between turns, so
// it either re-states an observation about code that's since been fixed, or
// treats a reply to its own message ("what do you mean?") as a fresh code
// review and says the same thing again. Both confirmed with live tests.
function codeChangeNote(previousCode, code) {
  if (previousCode == null || code == null) return "";
  if (previousCode === code) return "(The code hasn't changed since your last reply — this message is about the conversation, not new code.)";
  const before = new Set(previousCode.split("\n").map((l) => l.trimEnd()).filter(Boolean));
  const after = new Set(code.split("\n").map((l) => l.trimEnd()).filter(Boolean));
  const removed = [...before].filter((l) => !after.has(l)).map((l) => `- ${l}`);
  const added = [...after].filter((l) => !before.has(l)).map((l) => `+ ${l}`);
  return `The learner edited the code since your last reply. Anything you said about the old version may no longer apply. Changed lines:\n\`\`\`\n${[...removed, ...added].join("\n")}\n\`\`\``;
}

// What one message may carry. A very long file, or a run that printed a
// flood of errors, would otherwise make a request the provider refuses (or
// bills heavily) — the start and the end are kept, where the interesting
// parts usually are.
const CODE_LIMIT = 40_000;
const RUN_LIMIT = 20_000;
function clip(text, limit, what) {
  if (text == null || text.length <= limit) return text;
  const half = Math.floor(limit / 2);
  return `${text.slice(0, half)}\n...[${text.length - limit} characters of this ${what} left out here]...\n${text.slice(-half)}`;
}

// Whether an attached run record is a run of this exact code.
export function runIsCurrent(runContext, code) {
  if (!runContext) return false;
  const ranCode = runContext.match(/## Code as run\n```\n([\s\S]*?)\n```/)?.[1];
  const same = (s) => s.replace(/\r\n/g, "\n").trimEnd(); // Windows vs Unix line endings aren't an edit
  return !(ranCode != null && code != null && same(ranCode) !== same(code));
}

// Whether a run record ends with an error (its Error section isn't "(none)").
export function runEndedWithError(runContext) {
  return /## Error\n(?!\(none\))/.test(String(runContext ?? "").replace(/\r\n/g, "\n"));
}

// A run record's error text, or null when the run ended without one.
const runErrorText = (runContext) => String(runContext ?? "").replace(/\r\n/g, "\n").match(/## Error\n```\n([\s\S]*?)\n```/)?.[1] ?? null;

// Where a Python run stopped, read off the traceback and quoted from their
// file. With only the traceback, the tutor blamed "-7j is a complex number"
// in 6 of 6 replies and never named line 20, the int(input()) with no try
// around it (python-docs-experiment.mjs, 2026-10-08).
// The blocks around it are named too (`while num <= 0:`, `def is_even():`),
// so whether the line sits inside a `try:` is in plain sight.
export function pythonCrashLine(errorText, code) {
  const frames = [...String(errorText ?? "").matchAll(/File "<exec>", line (\d+)/g)];
  if (!frames.length) return "";
  const n = Number(frames.at(-1)[1]);
  const lines = String(code ?? "").replace(/\r\n/g, "\n").split("\n");
  const line = lines[n - 1];
  if (!line?.trim()) return "";
  const indent = (s) => s.match(/^\s*/)[0].replace(/\t/g, "    ").length;
  const blocks = [];
  let level = indent(line);
  for (let i = n - 2; i >= 0 && level > 0; i--) {
    const header = lines[i].replace(/#.*$/, "").trimEnd();
    if (header.trim() && indent(lines[i]) < level && header.endsWith(":")) {
      blocks.push(`inside \`${header.trim()}\` (line ${i + 1})`);
      level = indent(lines[i]);
    }
  }
  const message = errorText.trim().split("\n").at(-1).trim();
  return `Where their run stopped: line ${n} of their file, \`${line.trim()}\`${blocks.length ? ` — ${blocks.join(", ")}` : ""} — with ${message}`;
}

export function buildUserContent({ trigger, question, filename, code, previousCode, runContext }) {
  const parts = [];
  const lead = question || TRIGGER_PROMPTS[trigger];
  if (lead) parts.push(lead);
  const note = codeChangeNote(previousCode, code);
  if (note) parts.push(note);
  if (filename && code != null) parts.push(`Current contents of ${filename}:\n\`\`\`\n${clip(code, CODE_LIMIT, "file")}\n\`\`\``);
  // What this app's runtime for the file can and can't do (languages.json).
  // Without it the tutor wrote QB64 graphics (SCREEN 13 / PSET) for a BASIC
  // that has none, then chased an invisible comma for eight replies.
  const runtime = filename && LANGUAGES[filename.includes(".") ? filename.split(".").pop().toLowerCase() : ""]?.tutorNote;
  if (runtime) parts.push(`How ${filename} runs in this app: ${runtime}`);
  // Labelled as what the learner actually saw — with a bare "Most recent run:"
  // header, a live test showed the model telling the learner "I can't see the
  // actual output" while the record was right there, then arguing about output
  // that the record contradicted.
  if (runContext) {
    // Pyodide prefixes every traceback with ~15 lines of its own internal
    // frames before the one that points at the learner's code — noise that
    // buries the actual error line. Keep only the learner's frames.
    runContext = runContext.replace(/Traceback \(most recent call last\):\n[\s\S]*?(?=  File "<exec>")/g, "Traceback (most recent call last):\n");
    // A run of older code is left out, not just flagged: a live session had
    // the learner delete their print(a)/print(b) lines, and the tutor — with
    // the old run attached and labelled "earlier version" — still told them
    // to delete print(a) and print(b), reading the old code and output as now.
    if (!runIsCurrent(runContext, code)) parts.push("They ran an earlier version of this code; they've edited it since, so that run is left out — it no longer shows what this code does. Go by the code above only.");
    else parts.push(`Their most recent run, attached automatically by the app (the learner didn't paste it) — the Output section is exactly what appeared on their screen, including what they typed at input() prompts.\n${clip(runContext, RUN_LIMIT, "run record")}`);
  }
  // The documentation for what a Python file uses (python-reference.js), so
  // facts about Python come from the docs rather than the model's memory.
  if (filename?.toLowerCase().endsWith(".py")) {
    const errorText = runContext && runIsCurrent(runContext, code) ? runErrorText(runContext) : null;
    const crash = pythonCrashLine(errorText, code);
    if (crash) parts.push(crash);
    const docs = pythonReferenceFor({ code, question, errorText });
    if (docs) parts.push(docs);
  }
  return parts.join("\n\n") || "Can you check my code?";
}

// The run tool's guidance travels with the tool (tutorTools below), and the
// provider adds it only to requests that actually carry the tool — with the
// tool described but not offered, the tutor claims "I ran it privately to
// check" when it couldn't have. Answers made without it get NO_RUN_NOTE.
const NO_RUN_NOTE = `

You can't run their code for this reply: don't say you ran, tried or tested it — go by the code and any run attached.`;
const RUN_TOOL_NOTE = `

You have a tool, run_learner_code, that runs their file privately exactly as it is, with inputs you choose; they never see these runs. Use it to check before you claim what the code does or prints — especially with no run attached, or for an input you're about to talk about. Use it too before you say whether something is allowed in the language (a comma, parentheses, a semicolon, indentation) and whenever the learner disputes what you said: the result is the truth, whatever they or you believed. If the run backs you, keep your answer and say it ran; don't switch sides because they sound sure, and don't open with "You're right" or "my mistake" when they aren't. Say you ran it only if you called the tool while writing this reply — results from earlier replies aren't in front of you, so run it again rather than recalling it. Report only the output or error the run actually gave you; never write an error message you didn't get. It runs only their file as it is: never say you ran other code (a version check, a test line) — suggest they add it and press Run instead. A run that gives no error doesn't always mean the line is right: a misspelled keyword can be read as something else (a call to a method that doesn't exist, say), which fails only if that line is reached — say what it actually does. Mention a run only when it helps ("I tried 30 and 25 and got \`5.0\`", "I ran it — it works as written").`;

// Notes are written between replies by reviseLearnerNotes (learner-notes.js);
// here they're only read, so the tutor starts every message knowing who it's
// talking to.
export function buildSystemPrompt(instructions, { tools, notes } = {}) {
  let prompt = instructions;
  if (notes != null) {
    prompt += `\n\nYour notes about this learner from earlier sessions — use them to pitch your replies; if the conversation in front of you contradicts them, the conversation wins. Don't bring them up unless asked. If they ask what you remember, or whether anything about them is saved, be straight: you keep these short notes on how they're doing, stored on their computer, and they can read, edit or clear them in Settings (beyond that, you don't know how the app stores things):\n${notes || "(none yet)"}`;
  }
  // With the tool, the provider adds its note (or NO_RUN_NOTE, if it ends up
  // answering without the tool); without it, the tutor can't run anything.
  if (!tools?.length) prompt += NO_RUN_NOTE;
  return prompt;
}

// run_learner_code: lets the tutor check what the learner's code actually
// does instead of predicting it (live tests caught it inventing output more
// than once). Python runs in its own worker; the other built-in languages (bundled
// runners, JSON's checker) through runner.js. Not languages that download
// or need an install first — a private check mustn't start a 27 MB download.
export function canRunPrivately(filename) {
  const ext = filename?.includes(".") ? filename.split(".").pop().toLowerCase() : "";
  const l = LANGUAGES[ext];
  return Boolean(l?.run && !l.setupOnFirstRun && (l.run.engine === "pyodide" || l.run.engine === "json" || l.run.bundledNode));
}

// A finished answer is checked before it's shown (chat()'s `review`), for
// claims the tool use doesn't back. From the suites (2026-10-01): "I ran
// your code" with no run in 27 of 116 held-out conversations; "I changed …
// and ran it again" (the tool can't change code); "your code will crash
// with a syntax error" and "that comma isn't allowed" with no run attached
// and none made — both wrong; "I just ran it and it printed `1 2 3 4 5`"
// after a run that printed 1 to 4.
//   "I ran your code", "I've tested it", "I tried 30"
const RAN_CLAIM = /\b(?:I (?:just |also |actually )?(?:ran|tested|executed|tried(?! to\b))|I(?:'ve| have) (?:just |also |actually )?(?:run|tested|executed|tried(?! to\b)))\b(?! into\b)/i;
//   "I changed … to … and ran it", "when I fixed it, it printed"
const CHANGED_RUN = /\bI (?:changed|modified|edited|fixed|replaced|swapped|added|removed|tweaked|corrected|updated)\b.*\b(?:ran|run|printed|prints|worked|works|gave|gives|got|showed|output)\b/i;
//   what the code does, or whether something in it is allowed
const BEHAVIOUR_CLAIM = /\b(?:syntax ?error|will (?:crash|fail|error|print|show|output|run)\b|won't (?:run|work)\b|(?:throws|raises|gives|causes|shows|get|see) an? (?:\w+ )?error|runs? (?:fine|without (?:an? )?errors?|with no errors?|as written)|works? as written|(?:it|this|your (?:code|program|file)) (?:prints|outputs|shows|displays) `|(?:is|are|isn't|aren't)(?: not)? (?:allowed|valid|invalid|required|optional|needed|necessary)\b|not (?:allowed|needed|necessary)\b|(?:don't|do not|doesn't|does not) need\b|(?:will not|won't|doesn't|does not|isn't going to) (?:\w+ )?(?:work|sort|run|print|add|compare|count)\b)/i;
const CHANGED_RUN_NOTE = "\n\nYour run tool runs only their file as it is: never say you changed their code or ran a changed version — say what the change would do.";
//   "I ran it — it printed `1 2 3 4 5`" when the run printed something else
const QUOTED_OUTPUT = /\b(?:printed|prints|outputs?|output is|gave|gives|got|shows?|showed)\s+`([^`]+)`/gi;
const wrongOutputNote = (quoted) => `\n\nYour reply says a run gave \`${quoted}\`, but none of your runs did. Quote only what a run actually showed; for a change to their code, say what it would do instead of presenting it as a run.`;
// Curly quotes made straight, so "doesn’t" and "I’ve" match the patterns.
const straight = (s) => String(s ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
const squash = (s) => straight(s).replace(/\s+/g, " ").trim();
// Sentences without code blocks or emphasis marks ("I **ran** it" slipped
// past a check that kept them), and without "if I…" hypotheticals.
const sentencesOf = (text) => straight(text).replace(/```[\s\S]*?```/g, " ").replace(/[*_]+/g, "").split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim() && !/\bif I\b/i.test(s));

//   "My last reply was wrong", "I made a mistake": a reversal, which needs a
//   run behind it (the variation suite, 2026-10-03: correct answers reversed
//   under a bare "no thats wrong", with invented reasons)
const RETRACTION = /\b(?:my (?:\w+ ){0,2}(?:reply|answer|message|suggestion|explanation|fix|advice) (?:was|is) (?:wrong|incorrect|off|mistaken)|I was wrong|I made a mistake|I got (?:that|it) wrong|I misread|my mistake)\b/i;
//   "your code is already correct", "no changes needed" (the same suite:
//   said of code that still failed, after "it's fine, leave it")
const CORRECT_CLAIM = /\b(?:your code is (?:already )?(?:correct|fine|right|ok)|(?:the|this|your) code (?:is|looks) (?:correct|fine|right) as (?:it is|written)|no (?:changes|fixes) (?:are )?needed|nothing (?:needs|to) (?:be )?(?:fix|chang)|already correct)/i;
const STILL_FAILS_NOTE = "\n\nTheir code as it is now still fails — the run shows the error. Don't call it correct or fine; say once, in one short sentence, that it still fails and where, then leave it.";

// `runAttached`: a run of this exact code is in the message; `runFailed`:
// that run ended with an error. `results`: what this reply's runs returned
// ({ screen, error }).
export function answerReview({ code, runAttached = false, runFailed = false }) {
  const empty = !String(code ?? "").trim();
  return (text, { ran, results = [] }) => {
    const sentences = sentencesOf(text);
    if (!ran && sentences.some((s) => RAN_CLAIM.test(s))) return "run";
    if (!ran && sentences.some((s) => RETRACTION.test(s))) return "run";
    if (sentences.some((s) => CHANGED_RUN.test(s))) return CHANGED_RUN_NOTE;
    if (sentences.some((s) => CORRECT_CLAIM.test(s))) {
      const failed = runFailed || results.some((r) => r?.error);
      if (failed) return STILL_FAILS_NOTE;
      if (!ran && !runAttached && !empty) return "run";
    }
    if (ran && results.length) {
      // Output quoted in a sentence saying it ran, or in the one after it.
      const shown = squash(results.map((r) => `${r?.screen === "(nothing appeared on screen)" ? "" : r?.screen ?? ""} ${r?.error ?? ""}`).join(" "));
      // An error message quoted in a code block must be one a run gave (a
      // reply ran the file, then quoted "Uncovered constant" for PHP's
      // "Undefined constant").
      for (const block of straight(text).match(/```[\s\S]*?```/g) ?? []) {
        // Lines that read like an error message ("TypeError: …", "Fatal
        // error: …"), not code that mentions one (`except ValueError:`).
        const message = (l) => /\b[A-Z]\w*Error:|\bFatal error\b|\bUncaught\b/.test(l) && !/\b(?:except|raise|throw|catch|rescue|console\.error|new Error)\b/.test(l);
        for (const line of block.split("\n").filter(message)) {
          const quoted = squash(line);
          if (quoted && !shown.includes(quoted)) return wrongOutputNote(quoted);
        }
      }
      for (const [i, s] of sentences.entries()) {
        if (!RAN_CLAIM.test(s)) continue;
        for (const m of `${s} ${sentences[i + 1] ?? ""}`.matchAll(QUOTED_OUTPUT)) {
          const quoted = squash(m[1]).replace(/^(["'])(.*)\1$/, "$2");
          if (quoted && !shown.includes(quoted)) return wrongOutputNote(quoted);
        }
      }
    }
    if (!ran && !runAttached && !empty && sentences.some((s) => BEHAVIOUR_CLAIM.test(s))) return "run";
    return null;
  };
}

export function tutorTools({ filename, code, runAttached = false, runFailed = false }) {
  if (code == null || !canRunPrivately(filename)) return {};
  const py = filename.toLowerCase().endsWith(".py");
  const tools = [{
    type: "function",
    function: {
      name: "run_learner_code",
      description: "Privately run the learner's file exactly as it is now in this app's own runtime, typing the given answers at its input prompts in order. Returns what would appear on their screen (typed answers included) and any error. The learner never sees this run. You can't change the code — only choose the inputs.",
      parameters: {
        type: "object",
        properties: { inputs: { type: "array", items: { type: "string" }, description: "Answers to type at each input prompt, in order. Empty if the program asks for none." } },
        required: ["inputs"],
      },
    },
  }];
  return {
    tools,
    toolNote: RUN_TOOL_NOTE,
    noToolNote: NO_RUN_NOTE,
    review: answerReview({ code, runAttached, runFailed }),
    runTool: async (name, args) => {
      if (name !== "run_learner_code") return { error: `No tool named ${name}.` };
      const inputs = Array.isArray(args.inputs) ? args.inputs.map(String).slice(0, 20) : [];
      return py ? runLearnerCode({ code, inputs }) : runLearnerFile({ filename, code, inputs });
    },
  };
}

// One normalized event shape leaves here regardless of which provider is
// configured: {type:'text', text} chunks, then {type:'done', usage}.
export async function* askTutor({ trigger, question, filename, code, previousCode, lastRunPointer, history = [], projectDir }) {
  const { provider } = await getSettings();

  if (!provider?.baseUrl || !provider?.model) {
    yield { type: "text", text: "No model connected yet — open Settings and pick a provider." };
    yield { type: "done", usage: null };
    return;
  }

  const systemPrompt = await readFile(INSTRUCTIONS_PATH, "utf-8");

  // The last run's own record (code as run, output, error) is attached once
  // here rather than left for the model to go read itself — there's no
  // tool-use loop on this path, so anything it needs has to already be in
  // the message.
  let runContext = "";
  // Only a path of the exact form run-records.js writes — the pointer comes
  // from the client, and anything read here is sent to the model provider.
  const lastRunRecordPath = safeRunRecordPath(lastRunPointer?.match(/record in (.+)$/)?.[1]);
  if (lastRunRecordPath) {
    try { runContext = await readFile(path.join(projectDir, lastRunRecordPath), "utf-8"); }
    catch { /* record may not exist yet — fine, just no context this time */ }
  }

  const userContent = buildUserContent({ trigger, question, filename, code, previousCode, runContext });

  const current = runIsCurrent(runContext, code);
  const toolset = tutorTools({ filename, code, runAttached: current, runFailed: current && runEndedWithError(runContext) });
  let reply = "";
  let notice = false;
  for await (const event of chat({
    ...toolset,
    systemPrompt: buildSystemPrompt(systemPrompt, { ...toolset, notes: await getLearnerNotes() }),
    history,
    userContent,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.model,
    providerLabel: PROVIDER_LABELS[provider.preset] || provider.preset || "this model",
  })) {
    if (event.type === "text") reply += event.text;
    if (event.notice) notice = true;
    yield event;
  }

  // The app's own messages (a refusal, a timeout, an empty or cut-off reply)
  // say nothing about the learner — no notes update for those.
  if (notice) return;
  // Not awaited: the answer is already on screen; updating the notes happens
  // behind it and never delays the learner.
  updateNotesAfterReply({ trigger, question, reply, history, code, previousCode, provider, store: APP_NOTES })
    .catch(() => { /* a failed notes update just means no update this time */ });
}

// The real notes file. One server process = one app session, so the first
// update after startup begins a new session ("Working on now" is cleared).
const APP_NOTES = { get: getLearnerNotes, set: setLearnerNotes, record: recordHistory, state: { pending: new Map(), sessionStarted: false } };

// Asks the model whether the last few exchanges change what's worth
// remembering about the learner, and saves the grounded result if so.
// `store` is injectable so tests keep notes in memory instead of the real
// file. Returns { notes, dropped } when the notes changed, else null.
const NOT_A_REAL_REPLY = /^(Rate limit reached|Invalid API key|Couldn't reach|Model connection failed|No model connected)/;
const NOTE_WINDOW = 3; // exchanges, including the one just finished
// `store`: { get, set, record?(changes), state: { pending, sessionStarted } }.
export async function updateNotesAfterReply({ trigger, question, reply, history = [], code, previousCode, provider, store }) {
  if (!reply?.trim() || NOT_A_REAL_REPLY.test(reply)) return null;
  store.state ??= { pending: new Map(), sessionStarted: false };
  let notes = await store.get();
  const sessionChanges = [];
  if (!store.state.sessionStarted) {
    store.state.sessionStarted = true;
    const s = startSession(notes);
    if (s.notes !== notes) { notes = s.notes; await store.set(notes); sessionChanges.push(...s.changes); }
  }
  const exchanges = [];
  for (let i = 0; i + 1 < history.length; i++) {
    if (history[i].role === "user" && history[i + 1].role === "assistant") exchanges.push({ learner: history[i].content, tutor: history[i + 1].content });
  }
  exchanges.push({ learner: question || (trigger === "check" ? '(clicked "Check my code")' : ""), tutor: reply });
  const revised = await reviseLearnerNotes({ notes, exchanges: exchanges.slice(-NOTE_WINDOW), code, previousCode, state: store.state, baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: provider.model });
  if (revised == null) { await store.record?.(sessionChanges); return null; }
  await store.record?.([...sessionChanges, ...revised.changes]);
  if (revised.notes === notes) return revised.dropped.length ? { notes, dropped: revised.dropped, unchanged: true } : null;
  await store.set(revised.notes);
  return revised;
}
