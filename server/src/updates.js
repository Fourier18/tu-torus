// "A new version is available": there's no automatic updater, so without
// this a learner would stay on whatever version they first downloaded. Once
// a day (and only while Settings → "Check for new versions" is on) it asks
// GitHub's public releases list for the newest Tu-Torus. GitHub sees the
// request, as with visiting a web page; no code, files or settings go with it.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TUTOR_DIR } from "./paths.js";
import { getPublicSettings } from "./settings.js";

const RELEASES_URL = "https://api.github.com/repos/Fourier18/tu-torus/releases/latest";
const CACHE = path.join(TUTOR_DIR, "update-check.json");
const DAY = 24 * 60 * 60 * 1000;

// Is version a newer than b? (MAJOR.MINOR.PATCH, numbers compared as numbers)
export function isNewer(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map(Number);
  const pb = String(b).replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

export async function checkForUpdate(currentVersion) {
  const { checkForUpdates } = await getPublicSettings();
  if (checkForUpdates === false) return { available: false, checked: false };
  let latest = null;
  try {
    const cached = JSON.parse(await readFile(CACHE, "utf-8"));
    if (Date.now() - cached.at < DAY) latest = cached.latest;
  } catch { /* no recent check */ }
  if (!latest) {
    try {
      const res = await fetch(RELEASES_URL, {
        headers: { "User-Agent": `Tu-Torus/${currentVersion}`, Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { available: false, checked: false };
      const release = await res.json();
      latest = { version: String(release.tag_name || "").replace(/^v/, ""), url: release.html_url };
      await writeFile(CACHE, JSON.stringify({ at: Date.now(), latest })).catch(() => {});
    } catch {
      return { available: false, checked: false }; // offline, or GitHub didn't answer — try again next start
    }
  }
  return { available: Boolean(latest.version) && isNewer(latest.version, currentVersion), version: latest.version, url: latest.url, checked: true };
}
