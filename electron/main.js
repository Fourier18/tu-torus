const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");
const fs = require("node:fs");

let serverProcess;
const PORT = 4310;
// A packaged, double-clicked app has no visible console — `stdio: 'inherit'`
// goes nowhere. Logging to a real file instead, so backend errors are
// actually readable.
const LOG_PATH = path.join(app.getPath("userData"), "backend.log");

// Backstop for build/installer.nsh: if 1.0.0-era files are still sitting
// inside the app folder (e.g. the app was run from an unpacked build rather
// than upgraded by the installer) and the data folder has no workspace yet,
// copy them across before the server starts. Never overwrites.
function migrateLegacyWorkspace() {
  const legacy = path.join(__dirname, "..", "workspace");
  const current = path.join(app.getPath("userData"), "workspace");
  const hasCurrent = ["main.py", path.join(".tutor", "settings.json")].some((f) => fs.existsSync(path.join(current, f)));
  if (hasCurrent || !fs.existsSync(legacy)) return;
  try { fs.cpSync(legacy, current, { recursive: true, force: false, errorOnExist: false }); }
  catch (err) { fs.appendFileSync(LOG_PATH, `Workspace migration failed: ${err.message}\n`); }
}

function startServer() {
  migrateLegacyWorkspace();
  // Runs the backend with Electron's own bundled Node (ELECTRON_RUN_AS_NODE)
  // — this is the actual point of packaging with Electron: someone running
  // the built app needs no separate Node.js install at all.
  // fs.createWriteStream's stream isn't synchronously open when handed to
  // spawn's stdio — confirmed as a real regression: the app failed to start
  // at all when tried that way. A raw fd from openSync is immediately valid.
  const logFd = fs.openSync(LOG_PATH, "a");
  serverProcess = spawn(process.execPath, [path.join(__dirname, "..", "server", "src", "index.js")], {
    // TUTORUS_DATA_DIR: the learner's code, settings and run records go in
    // the per-user data folder, which installs and updates never touch —
    // not inside the install folder, where every reinstall wiped them.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(PORT), TUTORUS_DATA_DIR: app.getPath("userData") },
    stdio: ["ignore", logFd, logFd],
  });
}

function waitForServer(timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http.get(`http://127.0.0.1:${PORT}/api/settings`, (res) => { res.resume(); resolve(); })
        .on("error", () => {
          if (Date.now() - started > timeoutMs) reject(new Error("Backend didn't come up in time."));
          else setTimeout(attempt, 300);
        });
    };
    attempt();
  });
}

app.whenReady().then(async () => {
  startServer();
  try {
    await waitForServer();
  } catch (err) {
    // Real, honest failure — no silent hang, no fake success.
    const { dialog } = require("electron");
    dialog.showErrorBox("Tu-Torus", `The backend didn't start: ${err.message}`);
    app.quit();
    return;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Tu-Torus",
    autoHideMenuBar: true, // a real app window — no File/Edit/View menu bar, no address bar, none of the "just a browser tab" look
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  // Electron lets the loaded page's own <title> tag override the window
  // title after load by default — confirmed as a real bug: the taskbar
  // showed "frontend" (Vite's leftover scaffold title) instead of "Coding
  // Tutor". Fixed the HTML title too, but locking it here as well so this
  // can't silently regress again if the page's <title> ever changes.
  win.on("page-title-updated", (e) => e.preventDefault());
  // Settings links out to each provider's API-key page (target="_blank") —
  // without this, Electron either navigates this window away from the app
  // or silently drops the click. Send it to the system browser instead.
  // Only ordinary web links go out: shell.openExternal hands a URL to
  // whatever Windows has registered for its scheme, and pages the learner
  // builds render inside this window — a file:, ms-* or other custom-scheme
  // link must never reach it.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  // The window only ever shows the app itself.
  const appOrigin = `http://127.0.0.1:${PORT}`;
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(appOrigin)) e.preventDefault(); });
  win.loadURL(appOrigin);
});

app.on("window-all-closed", () => {
  serverProcess?.kill();
  app.quit();
});

app.on("before-quit", () => serverProcess?.kill());
