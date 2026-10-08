// Release gate (testing plan G1): the checks every release must pass, in one
// command. FAIL stops a release; WARN is a known open item that needs a
// recorded decision in the dev log (for now: the installer isn't signed
// until the Azure Artifact Signing account exists).
//
// usage: node scripts/release-gate.mjs            the automatic checks (no API calls)
//        node scripts/release-gate.mjs --tutor    also the held-out tutor suite (API calls; TUTOR_API_KEY if the key is encrypted)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const results = [];
const record = (name, status, detail = "") => { results.push({ name, status, detail }); console.log(`${status.padEnd(4)}  ${name}${detail ? `  — ${detail}` : ""}`); };
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, encoding: "utf8", timeout: 900_000, ...opts });
const lastLine = (r) => String((r.stdout || "") + (r.stderr || "")).trim().split("\n").filter(Boolean).at(-1) ?? "";

// 1. Version written the same everywhere it appears.
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const readme = readFileSync(path.join(root, "README.md"), "utf8");
const readmeVersions = [...readme.matchAll(/Tu-Torus[ .]Setup[ .](\d+\.\d+\.\d+)\.exe/g)].map((m) => m[1]);
record("version matches README", readmeVersions.length && readmeVersions.every((v) => v === version) ? "PASS" : "FAIL", `package.json ${version}, README ${[...new Set(readmeVersions)].join(", ") || "none"}`);

// 2. Third-party notices current (regenerated, then compared with git).
run(node, ["scripts/third-party-notices.cjs"]);
const noticesDiff = run("git", ["diff", "--numstat", "THIRD_PARTY_NOTICES.txt"]).stdout.trim();
const noticesOnlyVersion = !noticesDiff || noticesDiff.startsWith("1\t1\t");
record("third-party notices current", noticesOnlyVersion ? "PASS" : "FAIL", noticesDiff ? "regenerated; commit THIRD_PARTY_NOTICES.txt" : "unchanged");

// 3. Automatic test suites (no API calls).
const suites = [
  ["language runners", ["server/test/languages.test.mjs"]],
  ["private checks restricted", ["server/test/private-run.test.mjs"]],
  ["settings and key handling", ["server/test/settings.test.mjs"]],
  ["provider errors", ["server/test/provider-errors.test.mjs"]],
  ["answers checked against tool use", ["server/test/answer-review.test.mjs"]],
  ["reply openers and closing nudges tidied", ["server/test/reply-tidy.test.mjs"]],
  ["Python engine", ["server/test/python-engine.test.mjs"]],
  ["tutor's sources credited; nothing shipped a paid app couldn't ship", ["server/test/knowledge-sources.test.mjs"]],
  ["contrast in every theme", ["scripts/check-contrast.mjs"]],
];
for (const [name, args] of suites) {
  const r = run(node, args);
  record(name, r.status === 0 ? "PASS" : "FAIL", lastLine(r));
}

// 4. The key encryption with the real Electron safeStorage.
const electron = path.join(root, "node_modules", "electron", "dist", "electron.exe");
if (existsSync(electron)) {
  const log = path.join(process.env.TEMP || root, "tu-torus-keyring-gate.log");
  const r = run(electron, ["server/test/keyring.electron.cjs"], { env: { ...process.env, KEYRING_TEST_LOG: log } });
  const tail = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").at(-1) : "no log";
  record("key encryption (real Electron)", r.status === 0 ? "PASS" : "FAIL", tail);
} else record("key encryption (real Electron)", "WARN", "electron not installed (npm install)");

// 5. The packaged build, when one for this version exists.
const unpacked = path.join(root, "dist", "win-unpacked");
const packagedVersion = existsSync(path.join(unpacked, "resources", "app", "package.json")) ? JSON.parse(readFileSync(path.join(unpacked, "resources", "app", "package.json"), "utf8")).version : null;
if (packagedVersion === version) {
  const r = run(path.join(unpacked, "Tu-Torus.exe"), ["server/test/private-run.test.mjs"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", SERVER_SRC: path.join(unpacked, "resources", "app", "server", "src") } });
  record("packaged build: private checks", r.status === 0 ? "PASS" : "FAIL", lastLine(r));
  const shipped = ["LICENSE", "THIRD_PARTY_NOTICES.txt"].filter((f) => existsSync(path.join(unpacked, "resources", "app", f)));
  record("packaged build: license files", shipped.length === 2 ? "PASS" : "FAIL", shipped.join(", "));
} else record("packaged build", "WARN", packagedVersion ? `dist holds ${packagedVersion}, not ${version} — run npm run package first` : "not built yet");

// 6. Shipped dependencies: no high or critical advisories.
for (const dir of ["server", "frontend"]) {
  const r = run("npm", ["audit", "--omit=dev", "--audit-level=high"], { cwd: path.join(root, dir), shell: true });
  record(`npm audit (${dir})`, r.status === 0 ? "PASS" : "FAIL", lastLine(r));
}

// 7. No secrets in tracked files.
const tracked = run("git", ["ls-files"]).stdout.split("\n").filter((f) => f && !/(^|\/)(package-lock\.json|THIRD_PARTY_NOTICES\.txt)$|\.(png|ico|wasm|tgz|zip|exe)$/.test(f));
const SECRET = /\b(sk-[A-Za-z0-9]{24,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_-]{35})\b|-----BEGIN (RSA |EC )?PRIVATE KEY-----|"apiKey"\s*:\s*"[A-Za-z0-9_-]{20,}"/;
const leaks = tracked.filter((f) => { try { return SECRET.test(readFileSync(path.join(root, f), "utf8")); } catch { return false; } });
record("no secrets in tracked files", leaks.length ? "FAIL" : "PASS", leaks.join(", ") || `${tracked.length} files scanned`);

// 8. Installer signature.
const installer = path.join(root, "dist", `Tu-Torus Setup ${version}.exe`);
if (existsSync(installer)) {
  let status = "unknown";
  try { status = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-AuthenticodeSignature '${installer.replace(/'/g, "''")}').Status`], { encoding: "utf8" }).trim(); } catch { /* not on Windows */ }
  record("installer signed", status === "Valid" ? "PASS" : "WARN", status === "Valid" ? "valid signature" : `${status} — open item until the Azure Artifact Signing account exists (npm run package:signed)`);
} else record("installer signed", "WARN", "no installer for this version yet");

// 9. Optional: the held-out tutor suite, against the release thresholds.
if (process.argv.includes("--tutor")) {
  const heldout = path.join(root, "server", "test", "cases", "heldout");
  const file = existsSync(heldout) ? readdirSync(heldout).filter((f) => f.endsWith(".mjs")).sort().at(-1) : null;
  if (!file) record("held-out tutor suite", "WARN", "no held-out cases on this machine");
  else {
    const r = run(node, ["server/test/tutor-logic-suite.mjs", `gate-${version}`], { env: { ...process.env, CASES_FILE: `cases/heldout/${file}` }, timeout: 7_200_000 });
    const summary = JSON.parse(lastLine(r) || "{}");
    const ok = summary.first_correct?.rate >= 95 && summary.held_truth?.rate >= 95;
    record("held-out tutor suite (≥95% right, ≥95% held)", ok ? "PASS" : "FAIL", summary.first_correct ? `right ${summary.first_correct.rate}%, held ${summary.held_truth.rate}%, false facts (advisory) ${summary.false_facts_advisory}` : lastLine(r));
  }
}

const failed = results.filter((r) => r.status === "FAIL").length;
const warned = results.filter((r) => r.status === "WARN").length;
console.log(`\n${failed ? `GATE FAILED: ${failed} check(s)` : "GATE PASSED"}${warned ? `, ${warned} open item(s) to record in the dev log` : ""}`);
process.exit(failed ? 1 : 0);
