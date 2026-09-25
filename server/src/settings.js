// User-editable settings, not hardcoded defaults. Lives outside source so the
// frontend's settings panel (later) writes here directly — this file is the
// single source of truth for anything DESIGN.md calls "changeable in settings".
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { TUTOR_DIR } from "./paths.js";

const SETTINGS_PATH = path.join(TUTOR_DIR, "settings.json");

const FACTORY_DEFAULTS = {
  theme: "light", // [DESIGN.md] "Light theme by default... a second theme later is a new file"
  // No subscription/OAuth login — Anthropic's terms don't allow third-party
  // apps offering claude.ai login, and this repo is public. One generic
  // OpenAI-compatible chat-completions client covers every provider below;
  // "preset" just picks which baseUrl/model get suggested in Settings, all
  // three fields stay user-editable regardless of preset.
  provider: {
    preset: "mistral",
    baseUrl: "https://api.mistral.ai/v1",
    model: "codestral-latest",
    apiKey: "", // never committed — lives only in this file, which is gitignored (workspace/.tutor/)
  },
};

export async function getSettings() {
  try {
    return { ...FACTORY_DEFAULTS, ...JSON.parse(await readFile(SETTINGS_PATH, "utf-8")) };
  } catch {
    return { ...FACTORY_DEFAULTS };
  }
}

export async function setSetting(key, value) {
  const current = await getSettings();
  const next = { ...current, [key]: value };
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(next, null, 2));
  return next;
}
