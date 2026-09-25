import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSettings } from "./settings.js";
import { chat } from "./providers/openai-compatible.js";

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

// One normalized event shape leaves here regardless of which provider is
// configured: {type:'text', text} chunks, then {type:'done', usage}.
export async function* askTutor({ trigger, question, filename, code, lastRunPointer, history = [], projectDir }) {
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

  const parts = [];
  const lead = question || TRIGGER_PROMPTS[trigger];
  if (lead) parts.push(lead);
  if (filename && code != null) parts.push(`Current contents of ${filename}:\n\`\`\`\n${code}\n\`\`\``);
  if (runContext) parts.push(`Most recent run:\n${runContext}`);
  const userContent = parts.join("\n\n") || "Can you check my code?";

  yield* chat({
    systemPrompt,
    history,
    userContent,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.model,
    providerLabel: PROVIDER_LABELS[provider.preset] || provider.preset || "this model",
  });
}
