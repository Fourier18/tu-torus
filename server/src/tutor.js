import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSettings } from "./settings.js";
import { chat } from "./providers/openai-compatible.js";
import { runLearnerCode } from "./tools/run-learner-code.js";
import { getLearnerNotes, setLearnerNotes, reviseLearnerNotes } from "./learner-notes.js";

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
  check: "Take a fresh look at the code below as it stands right now — don't rely on anything you concluded in an earlier turn, even if this looks like the same question as before.",
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

export function buildUserContent({ trigger, question, filename, code, previousCode, runContext }) {
  const parts = [];
  const lead = question || TRIGGER_PROMPTS[trigger];
  if (lead) parts.push(lead);
  const note = codeChangeNote(previousCode, code);
  if (note) parts.push(note);
  if (filename && code != null) parts.push(`Current contents of ${filename}:\n\`\`\`\n${code}\n\`\`\``);
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
    const stale = ranCode != null && code != null && ranCode.trimEnd() !== code.trimEnd();
    parts.push(`Their most recent run, attached automatically by the app (the learner didn't paste it) — the Output section is exactly what appeared on their screen, including what they typed at input() prompts.${stale ? " That run was of an earlier version of the code than what's in the file now." : ""}\n${runContext}`);
  }
  return parts.join("\n\n") || "Can you check my code?";
}

// Each tool's guidance is added to the instructions only when that tool is
// actually offered — with the run tool described unconditionally, a test run
// without it had the tutor claim "I ran it privately to check" when it
// couldn't have.
const RUN_TOOL_NOTE = `

You have a tool, run_learner_code, that runs their file privately exactly as it is, with inputs you choose; they never see these runs. Use it to check before you claim what the code does or prints — especially with no run attached, or for an input you're about to talk about. Mention a run only when it helps ("I tried 30 and 25 and got \`5.0\`").`;

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
// than once) — Python only, the one engine that runs privately in-process.
export function tutorTools({ filename, code }) {
  const tools = [];
  if (filename?.endsWith(".py") && code != null) {
    tools.push({
      type: "function",
      function: {
        name: "run_learner_code",
        description: "Privately run the learner's file exactly as it is now, typing the given answers at its input() prompts in order. Returns what would appear on their screen (typed answers included) and any error. The learner never sees this run. You can't change the code — only choose the inputs.",
        parameters: {
          type: "object",
          properties: { inputs: { type: "array", items: { type: "string" }, description: "Answers to type at each input() prompt, in order. Empty if the program asks for none." } },
          required: ["inputs"],
        },
      },
    });
  }
  if (!tools.length) return {};
  return {
    tools,
    runTool: async (name, args) => (name === "run_learner_code" && code != null
      ? runLearnerCode({ code, inputs: Array.isArray(args.inputs) ? args.inputs.map(String).slice(0, 20) : [] })
      : { error: `No tool named ${name}.` }),
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
  const lastRunRecordPath = lastRunPointer?.match(/record in (.+)$/)?.[1];
  if (lastRunRecordPath) {
    try { runContext = await readFile(path.join(projectDir, lastRunRecordPath), "utf-8"); }
    catch { /* record may not exist yet — fine, just no context this time */ }
  }

  const userContent = buildUserContent({ trigger, question, filename, code, previousCode, runContext });

  const toolset = tutorTools({ filename, code });
  let reply = "";
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
    yield event;
  }

  // Not awaited: the answer is already on screen; updating the notes happens
  // behind it and never delays the learner.
  updateNotesAfterReply({ trigger, question, reply, provider, store: { get: getLearnerNotes, set: setLearnerNotes } })
    .catch(() => { /* a failed notes update just means no update this time */ });
}

// Asks the model whether this exchange changes what's worth remembering about
// the learner, and saves the new notes if so. `store` is injectable so tests
// keep notes in memory instead of the real file.
const NOT_A_REAL_REPLY = /^(Rate limit reached|Invalid API key|Couldn't reach|Model connection failed|No model connected)/;
export async function updateNotesAfterReply({ trigger, question, reply, provider, store }) {
  if (!reply?.trim() || NOT_A_REAL_REPLY.test(reply)) return null;
  const notes = await store.get();
  const learnerSaid = question || (trigger === "check" ? '(clicked "Check my code")' : "");
  const revised = await reviseLearnerNotes({ notes, learnerSaid, tutorSaid: reply, baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: provider.model });
  if (revised == null || revised === notes) return null;
  return store.set(revised);
}
