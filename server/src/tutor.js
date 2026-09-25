import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSettings } from "./settings.js";
import { chat } from "./providers/openai-compatible.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INSTRUCTIONS_PATH = path.join(__dirname, "tutor-instructions.md");

const PROVIDER_LABELS = { mistral: "Mistral", gemini: "Gemini", openrouter: "OpenRouter" };

// Auto-fired calls (never per keystroke) carry no typed question — this
// supplies what the model is actually being asked to do for each one.
const TRIGGER_PROMPTS = {
  pause: "I just paused after editing. Take a quick look at the code below — if something's clearly wrong, point it out briefly. If it looks fine so far, just say so in one short line; don't manufacture a critique.",
  error: "My code just failed. Help me understand why and how to fix it — don't just hand me the corrected code unless I ask for it.",
  check: "Can you check my code?",
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
