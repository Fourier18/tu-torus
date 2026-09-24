import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSettings } from "./settings.js";
import { chat as claudeChat } from "./providers/claude.js";
import { chat as customChat } from "./providers/custom.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INSTRUCTIONS_PATH = path.join(__dirname, "tutor-instructions.md");

// One normalized event shape leaves here regardless of provider — index.js
// and the browser never know which one answered.
export async function* askTutor({ message, projectDir, lastRunRecordPath }) {
  const systemPrompt = await readFile(INSTRUCTIONS_PATH, "utf-8");
  const { model, provider } = await getSettings();

  if (provider?.type === "custom") {
    // No tool-use loop for a third-party model — hand it the run record
    // directly, since it has no way to go read it itself.
    let contextText = "";
    if (lastRunRecordPath) {
      try { contextText = await readFile(path.join(projectDir, lastRunRecordPath), "utf-8"); }
      catch { /* record may not exist yet — fine, just no context this time */ }
    }
    yield* customChat({ message, systemPrompt, contextText, baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: provider.model });
    return;
  }

  yield* claudeChat({ message, projectDir, model, systemPrompt });
}
