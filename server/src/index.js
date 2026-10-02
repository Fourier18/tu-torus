import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { writeFile, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { runOnce } from "./runner.js";
import { writeRunRecord } from "./run-records.js";
import { askTutor } from "./tutor.js";
import { getPublicSettings, setSetting } from "./settings.js";
import { getLearnerNotes, setLearnerNotes, getNotesHistory, NOTES_MAX } from "./learner-notes.js";
import { WORKSPACE_DIR, APP_ROOT } from "./paths.js";
import { LANGUAGES } from "./languages.js";
import { isAllowedRequest, safeFileName } from "./security.js";

const PROJECT_DIR = WORKSPACE_DIR;

const app = express();

// Only the app itself may use this server — see security.js for why.
app.use((req, res, next) => {
  if (isAllowedRequest({ host: req.headers.host, origin: req.headers.origin })) return next();
  res.status(403).json({ error: "Forbidden" });
});
app.use(express.json({ limit: "15mb" })); // headroom for an attached canvas screenshot

// [DESIGN.md, Panel 1] Autosave target — the tutor has no live keystroke
// channel; the frontend sends its current in-memory code directly with each
// tutor call, but this file on disk is what the app reloads on a refresh.
// Written to a temporary file, then renamed over the real one, so a crash or
// power cut mid-save leaves the old version or the new one, never half of
// it. A failed save says why — the page shows it beside the file name.
app.post("/api/file", async (req, res) => {
  const filename = safeFileName(req.body?.filename);
  if (!filename || typeof req.body?.code !== "string") return res.status(400).json({ error: "that file name can't be used" });
  const target = path.join(PROJECT_DIR, filename);
  const tmp = path.join(PROJECT_DIR, `.${filename}.${process.pid}.saving`);
  try {
    await writeFile(tmp, req.body.code);
    await rename(tmp, target);
    res.json({ ok: true });
  } catch (err) {
    await unlink(tmp).catch(() => {});
    const reason = err.code === "ENOSPC" ? "the disk is full"
      : ["EACCES", "EPERM", "EBUSY"].includes(err.code) ? "Windows wouldn't let the file be written (another program may have it open)"
        : "the file couldn't be written";
    res.status(500).json({ error: reason });
  }
});

// Load on startup so a page refresh shows what's actually on disk, not a
// hardcoded default that can silently drift from the real file.
app.get("/api/file", async (req, res) => {
  const filename = safeFileName(req.query.filename);
  if (!filename) return res.status(400).json({ error: "Bad file name" });
  try {
    res.json({ filename, code: await readFile(path.join(PROJECT_DIR, filename), "utf-8") });
  } catch {
    res.json({ filename, code: null }); // no saved file yet — frontend falls back to its own default
  }
});

// The learner's files, newest first, for the file menu. Only plain files
// the file routes would accept (no folders, nothing starting with ".").
app.get("/api/files", async (_req, res) => {
  const { readdir, stat } = await import("node:fs/promises");
  const names = (await readdir(PROJECT_DIR, { withFileTypes: true })).filter((e) => e.isFile() && safeFileName(e.name) === e.name).map((e) => e.name);
  const files = await Promise.all(names.map(async (name) => ({ name, modified: (await stat(path.join(PROJECT_DIR, name))).mtimeMs })));
  res.json(files.sort((a, b) => b.modified - a.modified));
});

// Single source of truth (languages.json) — the frontend has no hardcoded
// copy of this table, so it can never drift from what runner.js actually uses.
app.get("/api/languages", (_req, res) => res.json(LANGUAGES));

// What the tutor remembers about the learner — shown in Settings so it's
// never hidden from them, and editable/clearable there.
app.get("/api/learner-notes", async (_req, res) => res.json({ notes: await getLearnerNotes(), max: NOTES_MAX, history: await getNotesHistory(20) }));
app.post("/api/learner-notes", async (req, res) => res.json({ notes: await setLearnerNotes(req.body?.notes ?? "") }));

// Settings → About: the version, and the licenses (the app's own LICENSE and
// THIRD_PARTY_NOTICES.txt, both shipped in the app folder).
const APP_VERSION = JSON.parse(await readFile(path.join(APP_ROOT, "package.json"), "utf-8")).version;
app.get("/api/about", (_req, res) => res.json({ version: APP_VERSION }));
app.get("/api/licenses", async (_req, res) => {
  try {
    const [own, notices] = await Promise.all(["LICENSE", "THIRD_PARTY_NOTICES.txt"].map((f) => readFile(path.join(APP_ROOT, f), "utf-8")));
    res.type("text/plain").send(`${own.trim()}\n\n\n${notices}`);
  } catch {
    res.status(404).type("text/plain").send("The license files aren't in this copy of Tu-Torus. They're at https://github.com/Fourier18/tu-torus (LICENSE and THIRD_PARTY_NOTICES.txt).");
  }
});

// The page gets the settings without the API key (getPublicSettings: only
// whether one is saved and its last four characters).
app.get("/api/settings", async (_req, res) => res.json(await getPublicSettings()));
app.post("/api/settings", async (req, res) => {
  const { key, value } = req.body;
  res.json(await setSetting(key, value));
});

// Fires only on: a typing pause, a run that ended in error, the "check my
// code" button, or a typed question — never per keystroke. `trigger`
// distinguishes which of those this call is; `history` is the last few
// messages only, not the full session.
app.post("/api/tutor", async (req, res) => {
  const { trigger, question, lastRunPointer, filename, code, previousCode, history } = req.body;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");

  try {
    for await (const event of askTutor({ trigger, question, filename, code, previousCode, lastRunPointer, history, projectDir: PROJECT_DIR })) {
      if (event.type === "text") res.write(`data: ${JSON.stringify({ type: "text", value: event.text })}\n\n`);
      if (event.type === "tool" && event.name === "run_learner_code") res.write(`data: ${JSON.stringify({ type: "status", value: "Trying your code…" })}\n\n`);
    }
  } catch (err) {
    console.error("TUTOR ERROR:", err);
    res.write(`data: ${JSON.stringify({ type: "error", value: String(err) })}\n\n`);
  }
  res.end();
});

const httpServer = createServer(app);

// Run channel: the frontend talks to this WebSocket, which dispatches to
// whichever engine the language actually needs (Pyodide or a local
// toolchain) — see runner.js.
// verifyClient: browsers let any website open a WebSocket to localhost, and
// this channel runs code — only the app's own page may connect.
const wss = new WebSocketServer({
  server: httpServer,
  path: "/run",
  verifyClient: ({ origin, req }) => isAllowedRequest({ host: req.headers.host, origin: origin || undefined }),
});

wss.on("connection", (ws) => {
  let session = null;

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "start") {
      const filename = safeFileName(msg.filename);
      const { code } = msg;
      if (!filename || typeof code !== "string") {
        ws.send(JSON.stringify({ type: "exit", ok: false, preExecution: true, error: "That file name can't be run." }));
        return;
      }
      const ext = filename.includes(".") ? filename.split(".").pop() : ""; // "WUE" has no ending — not ".WUE"

      session = await runOnce({
        file: filename,
        ext,
        code,
        onData: ({ stream, text }) => ws.send(JSON.stringify({ type: "output", stream, text })),
        // Record first, then "exit": the output panel closes this socket as
        // soon as it hears "exit", so a "run-recorded" sent after it usually
        // arrived on a closed connection — the app never learned the run
        // existed and the tutor was sent no run at all (it then described a
        // run of its own as "your last run").
        onExit: async ({ ok, output, error, preExecution }) => {
          const record = await writeRunRecord({ filename, code, output, error });
          ws.send(JSON.stringify({ type: "run-recorded", ...record }));
          // The app's own reasons for ending a run (time limit, output cap)
          // are shown; a program's own error output already streamed as-is.
          const reason = !preExecution && /^(Timed out|Stopped —|Compile timed out)/.test(error ?? "") ? error : undefined;
          ws.send(JSON.stringify({ type: "exit", ok, preExecution, error: preExecution ? error : undefined, reason }));
          session = null;
        },
      });
    }

    if (msg.type === "stdin" && session) session.write(msg.text);
    if (msg.type === "stop" && session) session.kill();
  });

  ws.on("close", () => session?.kill());
});

// [Electron packaging] Serves the frontend's production build when present,
// so the packaged app is one process on one port — Electron just points a
// window at it. `npm run dev` (Vite's own dev server on 5173, proxying to
// this backend) is unaffected: it never builds frontend/dist, so this block
// silently does nothing during normal development.
const distDir = path.join(APP_ROOT, "frontend", "dist");
try {
  await import("node:fs").then((fs) => fs.accessSync(distDir));
  app.use(express.static(distDir));
  app.get(/^(?!\/api|\/run).*/, (_req, res) => res.sendFile(path.join(distDir, "index.html")));
} catch { /* dist not built — dev mode via Vite, nothing to do here */ }

const PORT = process.env.PORT || 4310;
// 127.0.0.1 only — never reachable from other machines on the network.
httpServer.listen(PORT, "127.0.0.1", () => console.log(`Backend on http://127.0.0.1:${PORT}`));
