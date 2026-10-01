// settings.js with the API key encrypted at rest. The real keyring is
// Electron's safeStorage in the main process; here this test plays the main
// process: it starts settings.js in a child with an IPC channel and answers
// its encrypt/decrypt requests with a stand-in cipher. Checks: a plain-text
// key from 1.6.x moves into encrypted storage; the page's view never carries
// the key; keep / replace / remove; a key that can't be decrypted; no
// keyring at all (development); a corrupted settings file is kept aside.
//
// usage: node server/test/settings.test.mjs
import { fork, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const self = fileURLToPath(import.meta.url);
const SETTINGS = pathToFileURL(path.join(path.dirname(self), "..", "src", "settings.js")).href;

if (process.argv[2] === "child") {
  // Runs the requested steps against settings.js and reports each result.
  const { getSettings, getPublicSettings, setSetting } = await import(SETTINGS);
  const steps = JSON.parse(process.argv[3]);
  const results = [];
  for (const [op, ...args] of steps) {
    if (op === "get") results.push(await getSettings());
    if (op === "public") results.push(await getPublicSettings());
    if (op === "set") results.push(await setSetting(...args));
  }
  console.log("RESULT " + JSON.stringify(results));
  process.exit(0);
}

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`); if (!ok) failed++; };
const KEY = "sk-test-0000-1234";

function scenario({ settings, steps, keyring = true, decryptFails = false }) {
  const data = mkdtempSync(path.join(os.tmpdir(), "tu-torus-settings-"));
  const file = path.join(data, "workspace", ".tutor", "settings.json");
  if (settings !== undefined) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof settings === "string" ? settings : JSON.stringify(settings));
  }
  return new Promise((resolve) => {
    // With a keyring: forked, with the IPC channel the app's main process
    // provides. Without: a plain process, as in development.
    const env = { ...process.env, TUTORUS_DATA_DIR: data };
    const child = keyring
      ? fork(self, ["child", JSON.stringify(steps)], { env, stdio: ["ignore", "pipe", "pipe", "ipc"] })
      : spawn(process.execPath, [self, "child", JSON.stringify(steps)], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    if (keyring) child.on("message", (msg) => {
      if (msg?.type !== "keyring") return;
      const reply = (f) => child.send({ type: "keyring", id: msg.id, ...f });
      if (msg.op === "available") return reply({ ok: true, result: true });
      if (msg.op === "encrypt") return reply({ ok: true, result: "ENC:" + Buffer.from(msg.data).toString("base64") });
      if (msg.op === "decrypt") {
        if (decryptFails || !String(msg.data).startsWith("ENC:")) return reply({ ok: false, error: "can't decrypt" });
        return reply({ ok: true, result: Buffer.from(String(msg.data).slice(4), "base64").toString() });
      }
    });
    child.on("exit", () => {
      const line = out.split("\n").find((l) => l.startsWith("RESULT "));
      let onDisk = null;
      try { onDisk = readFileSync(file, "utf8"); } catch {}
      const files = readdirSync(path.dirname(file));
      rmSync(data, { recursive: true, force: true });
      resolve({ results: line ? JSON.parse(line.slice(7)) : null, onDisk, files, out });
    });
  });
}

const legacy = { theme: "dark", provider: { preset: "mistral", baseUrl: "https://api.mistral.ai/v1", model: "mistral-large-latest", apiKey: KEY } };

// 1. A plain-text key from 1.6.x moves into encrypted storage.
{
  const r = await scenario({ settings: legacy, steps: [["get"], ["public"]] });
  const [server, page] = r.results ?? [];
  check("plain key is migrated: file no longer holds it", r.onDisk && !r.onDisk.includes(KEY) && r.onDisk.includes("apiKeyEncrypted"), r.onDisk ?? r.out);
  check("server still gets the key", server?.provider?.apiKey === KEY, JSON.stringify(server));
  check("page view has no key, only that one is saved and its last 4", page && !JSON.stringify(page).includes(KEY) && page.provider.apiKeySet === true && page.provider.apiKeyLast4 === "1234", JSON.stringify(page));
  check("other settings survive the migration", server?.theme === "dark" && server?.provider?.model === "mistral-large-latest");
  check("no temporary files left behind", r.files.every((f) => !f.endsWith(".tmp")), r.files.join(","));
}

// 2. Keep, replace, remove.
{
  const r = await scenario({ settings: legacy, steps: [
    ["set", "provider", { preset: "mistral", baseUrl: "https://api.mistral.ai/v1", model: "other-model" }],
    ["get"],
    ["set", "provider", { preset: "mistral", baseUrl: "https://api.mistral.ai/v1", model: "other-model", apiKey: "sk-new-9999" }],
    ["get"],
    ["set", "provider", { preset: "groq", baseUrl: "https://api.groq.com/openai/v1", model: "m", apiKey: "" }],
    ["get"],
  ] });
  const [keptPage, kept, replacedPage, replaced, removedPage, removed] = r.results ?? [];
  check("saving without a key keeps the saved one", kept?.provider?.apiKey === KEY && kept.provider.model === "other-model", JSON.stringify(kept));
  check("set returns the page view (no key)", keptPage && !JSON.stringify(keptPage).includes(KEY) && !JSON.stringify(replacedPage).includes("sk-new-9999"));
  check("a typed key replaces it", replaced?.provider?.apiKey === "sk-new-9999", JSON.stringify(replaced));
  check("an empty key removes it", removed?.provider?.apiKey === "" && removedPage?.provider?.apiKeySet === false, JSON.stringify(removed));
  check("file never holds a key in plain text", r.onDisk && !r.onDisk.includes("sk-new-9999") && !r.onDisk.includes(KEY));
}

// 3. A key that can't be decrypted (settings copied from another computer).
{
  const r = await scenario({ settings: { provider: { preset: "mistral", baseUrl: "x", model: "m", apiKeyEncrypted: "ENC:garbage" } }, steps: [["public"], ["get"]], decryptFails: true });
  const [page, server] = r.results ?? [];
  check("unreadable key is reported, not guessed", page?.provider?.apiKeyUnreadable === true && page.provider.apiKeySet === false && server?.provider?.apiKey === "", JSON.stringify(r.results));
}

// 4. No keyring (development): the key stays as it was.
{
  const r = await scenario({ settings: legacy, steps: [["get"], ["public"]], keyring: false });
  const [server, page] = r.results ?? [];
  check("without a keyring the key still works", server?.provider?.apiKey === KEY, r.out);
  check("without a keyring the page view still has no key", page && !JSON.stringify(page).includes(KEY));
}

// 5. A corrupted settings file is kept aside, not overwritten.
{
  const r = await scenario({ settings: "{ this is not json", steps: [["public"], ["set", "theme", "dark"]] });
  check("corrupted file: defaults load", r.results?.[0]?.theme === "light", JSON.stringify(r.results));
  check("corrupted file: a copy is kept", r.files.some((f) => f.startsWith("settings.json.unreadable-")), r.files.join(","));
}

// 6. Only known settings can be changed.
{
  const r = await scenario({ settings: legacy, steps: [["set", "somethingElse", 1], ["public"]] });
  check("unknown setting ignored", r.results && !("somethingElse" in r.results[1]), JSON.stringify(r.results?.[1]));
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
