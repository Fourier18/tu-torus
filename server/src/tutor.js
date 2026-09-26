import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSettings } from "./settings.js";
import { chat } from "./providers/openai-compatible.js";
import { runLearnerCode } from "./tools/run-learner-code.js";

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
    parts.push(`Their most recent run, attached automatically by the app (the learner didn't paste it) — the Output section is exactly what appeared on their screen (what they typed at input() prompts isn't included).${stale ? " That run was of an earlier version of the code than what's in the file now." : ""}\n${runContext}`);
  }
  return parts.join("\n\n") || "Can you check my code?";
}

// Lets the tutor check what the learner's code actually does instead of
// predicting it (live tests caught it inventing output more than once).
// Python only — that's the one engine that can run privately in-process.
export function tutorTools({ filename, code }) {
  if (!filename?.endsWith(".py") || code == null) return {};
  return {
    tools: [{
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
    }],
    runTool: async (name, args) => (name === "run_learner_code"
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

  yield* chat({
    ...tutorTools({ filename, code }),
    systemPrompt,
    history,
    userContent,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.model,
    providerLabel: PROVIDER_LABELS[provider.preset] || provider.preset || "this model",
  });
}
