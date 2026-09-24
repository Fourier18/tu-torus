// User-editable settings, not hardcoded defaults. Lives outside source so the
// frontend's settings panel (later) writes here directly — this file is the
// single source of truth for anything DESIGN.md calls "changeable in settings".
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { TUTOR_DIR } from "./paths.js";

const SETTINGS_PATH = path.join(TUTOR_DIR, "settings.json");

const FACTORY_DEFAULTS = {
  model: "sonnet", // [DESIGN.md] "Default to the mid-tier Claude model, changeable in settings"
  theme: "light", // [DESIGN.md] "Light theme by default... a second theme later is a new file"
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
