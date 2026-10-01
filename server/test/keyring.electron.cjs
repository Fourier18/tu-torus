// End to end with the real keyring: Electron's main process (no window) and
// safeStorage, the real server started the way electron/main.js starts it,
// and a settings file holding a plain-text key from 1.6.x. Checks that the
// key is encrypted on disk with Windows' own protection, that the page's
// view never carries it, and that keep and replace work through the API.
//
// usage: node_modules/electron/dist/electron.exe server/test/keyring.electron.cjs
const { app, safeStorage } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { attachKeyring } = require("../../electron/keyring.cjs");

const KEY = "sk-e2e-test-5678";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "tu-torus-keyring-"));
app.setPath("userData", data);
const settingsFile = path.join(data, "workspace", ".tutor", "settings.json");
fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
fs.writeFileSync(settingsFile, JSON.stringify({ theme: "dark", provider: { preset: "mistral", baseUrl: "https://api.mistral.ai/v1", model: "mistral-large-latest", apiKey: KEY } }));

// Electron's main process doesn't print to a Windows shell, so results also
// go to a file (KEYRING_TEST_LOG, default tu-torus-keyring-test.log in TEMP).
const LOG = process.env.KEYRING_TEST_LOG || path.join(os.tmpdir(), "tu-torus-keyring-test.log");
fs.writeFileSync(LOG, "");
const say = (line) => { console.log(line); fs.appendFileSync(LOG, `${line}\n`); };
// An uncaught error in Electron's main process opens an error box on the
// desktop; a test reports it in the log and exits instead.
const quitWith = (err) => { say(`FAIL  ${err?.stack || err}`); app.exit(1); };
process.on("uncaughtException", quitWith);
process.on("unhandledRejection", quitWith);
let failed = 0;
const check = (name, ok, detail = "") => { say(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`); if (!ok) failed++; };
setTimeout(() => { say("FAIL  timed out"); app.exit(1); }, 90000).unref();
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const request = (port, method, url, body) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port, method, path: url, headers: { "Content-Type": "application/json" } }, (res) => {
    let text = ""; res.on("data", (d) => (text += d)); res.on("end", () => resolve(text));
  });
  req.on("error", reject);
  if (body) req.write(JSON.stringify(body));
  req.end();
});

app.whenReady().then(async () => {
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(__dirname, "..", "src", "index.js")], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(port), TUTORUS_DATA_DIR: data },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  attachKeyring(server);
  try {
    for (let i = 0; i < 60; i++) { try { await request(port, "GET", "/api/about"); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
    check("Windows encryption available", safeStorage.isEncryptionAvailable());

    const page = JSON.parse(await request(port, "GET", "/api/settings"));
    check("page view: a key is saved, ends in 5678", page.provider.apiKeySet === true && page.provider.apiKeyLast4 === "5678", JSON.stringify(page.provider));
    check("page view never carries the key", !JSON.stringify(page).includes(KEY));

    const onDisk = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    check("settings file no longer holds the key in plain text", !JSON.stringify(onDisk).includes(KEY) && !("apiKey" in onDisk.provider), JSON.stringify(onDisk.provider));
    const decrypted = onDisk.provider.apiKeyEncrypted ? safeStorage.decryptString(Buffer.from(onDisk.provider.apiKeyEncrypted, "base64")) : null;
    check("the encrypted key decrypts with this Windows account", decrypted === KEY);

    const kept = JSON.parse(await request(port, "POST", "/api/settings", { key: "provider", value: { preset: "mistral", baseUrl: "https://api.mistral.ai/v1", model: "other" } }));
    check("saving without a key keeps it", kept.provider.apiKeySet === true && kept.provider.model === "other");
    const replaced = JSON.parse(await request(port, "POST", "/api/settings", { key: "provider", value: { preset: "mistral", baseUrl: "https://api.mistral.ai/v1", model: "other", apiKey: "sk-replaced-4321" } }));
    const after = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    check("a new key replaces it, encrypted", replaced.provider.apiKeyLast4 === "4321" && !JSON.stringify(after).includes("sk-replaced-4321") && safeStorage.decryptString(Buffer.from(after.provider.apiKeyEncrypted, "base64")) === "sk-replaced-4321");
    check("other settings kept", after.theme === "dark");
  } catch (err) {
    check("test ran", false, err.stack);
  } finally {
    server.kill();
    // Electron keeps files of its own open in the data folder until it exits,
    // so removing it is best-effort (it's in TEMP either way).
    try { fs.rmSync(data, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* left for TEMP cleanup */ }
    say(failed ? `${failed} failed` : "all passed");
    app.exit(failed ? 1 : 0);
  }
});
