// The tutor's outside sources (server/knowledge/sources.json): every one is
// credited correctly, nothing ships unless its license allows it in a paid
// app too, and every shipped file is accounted for. Selling Tu-Torus later
// must not mean pulling material out, so the commercial rule applies now.
//
// usage: node server/test/knowledge-sources.test.mjs
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = path.join(root, "server", "knowledge");
const { sources } = JSON.parse(readFileSync(path.join(dir, "sources.json"), "utf8"));

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${JSON.stringify(detail)}`}`); if (!ok) failed++; };

const ids = sources.map((s) => s.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
check("source ids are unique", dupes.length === 0, dupes);

// Enough to credit it and to find it again if the link dies.
const REQUIRED = ["id", "kind", "title", "authors", "year", "url", "find", "archive", "license", "eligible", "commercial_ok", "attribution", "changes", "used_for", "files"];
for (const s of sources) {
  const missing = REQUIRED.filter((k) => s[k] === undefined || s[k] === "" || (Array.isArray(s[k]) && k === "authors" && !s[k].length));
  check(`${s.id}: has every field`, missing.length === 0, missing);
  check(`${s.id}: eligible is ship or cite`, s.eligible === "ship" || s.eligible === "cite", s.eligible);
  check(`${s.id}: archive link points at the Wayback Machine`, String(s.archive).startsWith("https://web.archive.org/web/"), s.archive);
  if (s.eligible === "ship") {
    check(`${s.id}: shippable only if a paid app may ship it too`, s.commercial_ok === true, s.commercial_ok);
    check(`${s.id}: shippable sources link their license`, Boolean(s.license_url), s.license_url);
  }
  if (s.files.length) check(`${s.id}: only 'ship' sources have shipped files`, s.eligible === "ship", s.files);
  for (const f of s.files) check(`${s.id}: shipped file exists: ${f}`, existsSync(path.join(dir, f)), f);
}

// Every file in the knowledge folder is ours (the manifest, the doctrine) or
// claimed by a source that may ship it.
const OURS = new Set(["sources.json", "doctrine.md"]);
const claimed = new Set(sources.flatMap((s) => s.files));
const walk = (d, rel = "") => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f), `${rel}${f}/`) : [`${rel}${f}`]));
const stray = walk(dir).filter((f) => !OURS.has(f) && !claimed.has(f));
check("every shipped knowledge file belongs to a source", stray.length === 0, stray);

// The doctrine cites only sources that are in the manifest.
const doctrine = readFileSync(path.join(dir, "doctrine.md"), "utf8");
const cited = [...new Set([...doctrine.matchAll(/\[([a-z0-9.-]+)\]/g)].map((m) => m[1]))];
const unknown = cited.filter((id) => !ids.includes(id));
check("doctrine cites only known sources", unknown.length === 0, unknown);

// The shipped notices credit every source, shipped or cited.
const notices = readFileSync(path.join(root, "THIRD_PARTY_NOTICES.txt"), "utf8");
const uncredited = sources.filter((s) => !notices.includes(s.attribution)).map((s) => s.id);
check("THIRD_PARTY_NOTICES.txt credits every source (run scripts/third-party-notices.cjs)", uncredited.length === 0, uncredited);

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
