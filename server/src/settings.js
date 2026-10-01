// User-editable settings, not hardcoded defaults. Lives outside source so the
// frontend's settings panel writes here directly — this file is the single
// source of truth for anything DESIGN.md calls "changeable in settings".
import { readFile, writeFile, mkdir, rename, copyFile } from "node:fs/promises";
import path from "node:path";
import { TUTOR_DIR } from "./paths.js";
import { keyringAvailable, encryptSecret, decryptSecret } from "./keyring.js";

const SETTINGS_PATH = path.join(TUTOR_DIR, "settings.json");

const FACTORY_DEFAULTS = {
  theme: "light", // [DESIGN.md] "Light theme by default... a second theme later is a new file"
  editorHints: false, // autocomplete, hints and error underlines in the editor — off until the learner turns them on
  checkForUpdates: true, // asks GitHub once a day whether a newer release exists (Settings can turn it off)
  // No subscription/OAuth login — Anthropic's terms don't allow third-party
  // apps offering claude.ai login, and this repo is public. One generic
  // OpenAI-compatible chat-completions client covers every provider below;
  // "preset" just picks which baseUrl/model get suggested in Settings, all
  // three fields stay user-editable regardless of preset.
  provider: {
    preset: "mistral",
    baseUrl: "https://api.mistral.ai/v1",
    model: "codestral-latest",
  },
};
// The settings the page may change; anything else in a request is ignored.
const EDITABLE = new Set(["theme", "editorHints", "checkForUpdates", "provider"]);

// The API key. In the app it's stored encrypted (apiKeyEncrypted, through
// keyring.js — Windows protects it with the user's own account); a copy of
// settings.json on another computer or account can't be read. Up to 1.6.x
// it was plain text (apiKey), and stays so only where there's no keyring
// (development, tests). The page never receives the key itself.
let keyCache = null; // { encrypted, plain } — decrypting once per change, not per request

async function readKey(provider) {
  if (provider?.apiKeyEncrypted) {
    if (keyCache?.encrypted === provider.apiKeyEncrypted) return { key: keyCache.plain };
    try {
      const plain = await decryptSecret(provider.apiKeyEncrypted);
      keyCache = { encrypted: provider.apiKeyEncrypted, plain };
      return { key: plain };
    } catch {
      return { key: "", unreadable: true }; // e.g. settings copied from another computer
    }
  }
  return { key: typeof provider?.apiKey === "string" ? provider.apiKey : "" };
}

async function storeKey(plain) {
  if (!plain) return {};
  if (await keyringAvailable()) {
    const encrypted = await encryptSecret(plain);
    keyCache = { encrypted, plain };
    return { apiKeyEncrypted: encrypted };
  }
  return { apiKey: plain };
}

const withoutKey = ({ apiKey, apiKeyEncrypted, ...rest } = {}) => rest;

// A settings file that isn't valid JSON is copied aside once, so the next
// save (which starts from the defaults) can't silently erase it.
let unreadableKept = false;
async function readStored() {
  let raw;
  try { raw = await readFile(SETTINGS_PATH, "utf-8"); } catch { return {}; }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    if (!unreadableKept) {
      unreadableKept = true;
      await copyFile(SETTINGS_PATH, `${SETTINGS_PATH}.unreadable-${Date.now()}`).catch(() => {});
    }
    return {};
  }
}

// Written to a temporary file, then renamed over the old one: a crash or
// power cut mid-save leaves either the old settings or the new, never half.
async function writeStored(data) {
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  const tmp = `${SETTINGS_PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, SETTINGS_PATH);
}

// A key still saved as plain text (1.6.x and earlier) moves into encrypted
// storage the first time the app can encrypt it.
async function migrate(stored) {
  const p = stored.provider;
  if (!p?.apiKey || p.apiKeyEncrypted || !(await keyringAvailable())) return stored;
  try {
    const next = { ...stored, provider: { ...withoutKey(p), ...(await storeKey(p.apiKey)) } };
    await writeStored(next);
    return next;
  } catch {
    return stored; // keep using it as it is; the next start tries again
  }
}

async function load() {
  const stored = await migrate(await readStored());
  const provider = { ...FACTORY_DEFAULTS.provider, ...(stored.provider || {}) };
  const keyState = await readKey(provider);
  return { stored, provider, keyState };
}

// The server's own view (the tutor, the notes): the key in plain text, in
// memory only.
export async function getSettings() {
  const { stored, provider, keyState } = await load();
  return { ...FACTORY_DEFAULTS, ...stored, provider: { ...withoutKey(provider), apiKey: keyState.key } };
}

// The page's view: never the key — whether one is saved, and its last four
// characters so the learner can tell which key it is.
export async function getPublicSettings() {
  const { stored, provider, keyState } = await load();
  return {
    ...FACTORY_DEFAULTS,
    ...stored,
    provider: {
      ...withoutKey(provider),
      apiKeySet: Boolean(keyState.key),
      apiKeyLast4: keyState.key ? keyState.key.slice(-4) : "",
      apiKeyUnreadable: Boolean(keyState.unreadable),
    },
  };
}

// provider.apiKey in the request: absent keeps the saved key, "" removes it,
// any other text replaces it.
export async function setSetting(key, value) {
  if (!EDITABLE.has(key)) return getPublicSettings();
  const stored = await migrate(await readStored());
  let next;
  if (key === "provider") {
    const incoming = value && typeof value === "object" ? value : {};
    const provider = { preset: incoming.preset, baseUrl: incoming.baseUrl, model: incoming.model };
    if (typeof incoming.apiKey !== "string") {
      const current = stored.provider || {};
      if (current.apiKeyEncrypted) provider.apiKeyEncrypted = current.apiKeyEncrypted;
      else if (current.apiKey) provider.apiKey = current.apiKey;
    } else {
      Object.assign(provider, await storeKey(incoming.apiKey.trim()));
    }
    next = { ...stored, provider };
  } else {
    next = { ...stored, [key]: value };
  }
  await writeStored(next);
  return getPublicSettings();
}
