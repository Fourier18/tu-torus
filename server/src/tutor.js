import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSettings } from "./settings.js";
import { chat } from "./providers/openai-compatible.js";
import { runLearnerCode, runLearnerFile } from "./tools/run-learner-code.js";
import { getLearnerNotes, setLearnerNotes, reviseLearnerNotes, startSession, recordHistory } from "./learner-notes.js";
import { safeRunRecordPath } from "./security.js";
import { LANGUAGES } from "./languages.js";

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
    const ranCode = runContext.match(/## Code as run\n```\n([\s\S]*?)\n```/)?.[1];
    const same = (s) => s.replace(/\r\n/g, "\n").trimEnd(); // Windows vs Unix line endings aren't an edit
    const stale = ranCode != null && code != null && same(ranCode) !== same(code);
    // A run of older code is left out, not just flagged: a live session had
    // the learner delete their print(a)/print(b) lines, and the tutor — with
    // the old run attached and labelled "earlier version" — still told them
    // to delete print(a) and print(b), reading the old code and output as now.
    if (stale) parts.push("They ran an earlier version of this code; they've edited it since, so that run is left out — it no longer shows what this code does. Go by the code above only.");
    else parts.push(`Their most recent run, attached automatically by the app (the learner didn't paste it) — the Output section is exactly what appeared on their screen, including what they typed at input() prompts.\n${clip(runContext, RUN_LIMIT, "run record")}`);
  }
  return parts.join("\n\n") || "Can you check my code?";
}

// Each tool's guidance is added to the instructions only when that tool is
// actually offered — with the run tool described unconditionally, a test run
// without it had the tutor claim "I ran it privately to check" when it
// couldn't have.
const RUN_TOOL_NOTE = `

You have a tool, run_learner_code, that runs their file privately exactly as it is, with inputs you choose; they never see these runs. Use it to check before you claim what the code does or prints — especially with no run attached, or for an input you're about to talk about. Use it too before you say whether something is allowed in the language (a comma, parentheses, a semicolon, indentation) and whenever the learner disputes what you said: the result is the truth, whatever they or you believed. If the run backs you, keep your answer and say it ran; don't switch sides because they sound sure, and don't open with "You're right" or "my mistake" when they aren't. Say you ran it only if you called the tool while writing this reply — results from earlier replies aren't in front of you, so run it again rather than recalling it. Report only the output or error the run actually gave you; never write an error message you didn't get. It runs only their file as it is: never say you ran other code (a version check, a test line) — suggest they add it and press Run instead. A run that gives no error doesn't always mean the line does what they think (a misspelled keyword can be read as something else and silently do nothing) — say what it actually does. Mention a run only when it helps ("I tried 30 and 25 and got \`5.0\`", "I ran it — it works as written").`;

// Notes are written between replies by reviseLearnerNotes (learner-notes.js);
// here they're only read, so the tutor starts every message knowing who it's
// talking to.
export function buildSystemPrompt(instructions, { tools, notes } = {}) {
  const names = new Set((tools ?? []).map((t) => t.function.name));
  let prompt = instructions;
  if (notes != null) {
    prompt += `\n\nYour notes about this learner from earlier sessions — use them to pitch your replies; if the conversation in front of you contradicts them, the conversation wins. Don't bring them up unless asked. If they ask what you remember, or whether anything about them is saved, be straight: you keep these short notes on how they're doing, stored on their computer, and they can read, edit or clear them in Settings (beyond that, you don't know how the app stores things):\n${notes || "(none yet)"}`;
  }
  if (names.has("run_learner_code")) prompt += RUN_TOOL_NOTE;
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

export function tutorTools({ filename, code }) {
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

  const toolset = tutorTools({ filename, code });
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
