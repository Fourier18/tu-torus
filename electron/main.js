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

function startServer() {
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
      http.get(`http://localhost:${PORT}/api/settings`, (res) => { res.resume(); resolve(); })
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
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadURL(`http://localhost:${PORT}`);
});

app.on("window-all-closed", () => {
  serverProcess?.kill();
  app.quit();
});

app.on("before-quit", () => serverProcess?.kill());
