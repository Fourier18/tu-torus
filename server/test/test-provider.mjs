// The provider settings the tutor suites run against, with the key in plain
// text. They're read from the app's settings file (or SETTINGS=<path>). From
// 1.7.0 the installed app keeps the key encrypted with the Windows account,
// readable only by the app itself — then give the suites the key in
// TUTOR_API_KEY, or as the only line of server/test/.tutor-api-key (ignored
// by git, never committed; .tutor-api-key.txt works too, since Notepad adds
// the ending).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILES = [".tutor-api-key", ".tutor-api-key.txt"].map((name) => path.join(here, name));

const CANDIDATES = [
  process.env.SETTINGS,
  path.join(process.env.APPDATA ?? "", "tu-torus", "workspace", ".tutor", "settings.json"),
  path.join(process.env.LOCALAPPDATA ?? "", "Programs", "tu-torus", "resources", "app", "workspace", ".tutor", "settings.json"),
].filter(Boolean);

export async function loadProvider() {
  let provider;
  for (const p of CANDIDATES) {
    try { provider = JSON.parse(await readFile(p, "utf-8")).provider; if (provider) break; } catch { /* try the next */ }
  }
  if (!provider) throw new Error(`No settings.json with a provider found in: ${CANDIDATES.join(", ")}`);
  let fromFile = "";
  for (const f of KEY_FILES) if (!fromFile) fromFile = await readFile(f, "utf-8").then((t) => t.trim()).catch(() => "");
  const apiKey = process.env.TUTOR_API_KEY || fromFile || provider.apiKey;
  if (!apiKey && provider.apiKeyEncrypted) {
    throw new Error("The app's settings hold the API key encrypted (Tu-Torus 1.7.0 and later). Set TUTOR_API_KEY to run the tutor suites.");
  }
  const { apiKeyEncrypted, ...rest } = provider;
  return { ...rest, apiKey: apiKey ?? "" };
}
