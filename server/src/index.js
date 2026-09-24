// [Electron packaging] This process is itself launched with
// ELECTRON_RUN_AS_NODE=1 (so Electron's bundled binary runs as plain Node
// instead of launching a GUI) — but that variable then inherits down to any
// child THIS process spawns. The Claude Agent SDK spawns its own bundled
// claude.exe as a child, and claude.exe is itself sensitive to this same
// variable (confirmed as a known issue: anthropics/claude-code#34836 —
// ELECTRON_RUN_AS_NODE leaking into child processes breaks Electron-adjacent
// binaries). Stripped here, before any SDK code runs, so it can't leak
// further down.
delete process.env.ELECTRON_RUN_AS_NODE;

import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { writeFile, readFile, mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { runOnce } from "./runner.js";
import { writeRunRecord } from "./run-records.js";
import { askTutor } from "./tutor.js";
import { getSettings, setSetting } from "./settings.js";
import { WORKSPACE_DIR, TUTOR_DIR } from "./paths.js";
import { LANGUAGES } from "./languages.js";

const PROJECT_DIR = WORKSPACE_DIR;
const USAGE_LOG = path.join(TUTOR_DIR, "usage.log"); // [DESIGN.md] "Log token usage per message from day one"

const app = express();
app.use(express.json({ limit: "5mb" }));

// [DESIGN.md, Panel 1] Autosave target — this is how the tutor's Read tool
// ever sees your current code; there is no live keystroke channel.
app.post("/api/file", async (req, res) => {
  const { filename, code } = req.body;
  await writeFile(path.join(PROJECT_DIR, filename), code);
  res.json({ ok: true });
});

// Load on startup so a page refresh shows what's actually on disk, not a
// hardcoded default that can silently drift from the real file.
app.get("/api/file", async (req, res) => {
  const filename = req.query.filename;
  try {
    res.json({ filename, code: await readFile(path.join(PROJECT_DIR, filename), "utf-8") });
  } catch {
    res.json({ filename, code: null }); // no saved file yet — frontend falls back to its own default
  }
});

// Single source of truth (languages.json) — the frontend has no hardcoded
// copy of this table, so it can never drift from what runner.js actually uses.
app.get("/api/languages", (_req, res) => res.json(LANGUAGES));

app.get("/api/settings", async (_req, res) => res.json(await getSettings()));
app.post("/api/settings", async (req, res) => {
  const { key, value } = req.body;
  res.json(await setSetting(key, value));
});

// One-shot tutor question. Attaches the last run record's pointer line only —
// not the file contents — per [DESIGN.md]: the Claude path reads run files
// itself; the custom-provider path (no tool-use loop) gets the record's
// actual content, extracted from the same pointer line below.
app.post("/api/tutor", async (req, res) => {
  const { message, lastRunPointer } = req.body;
  const fullMessage = lastRunPointer ? `${message}\n\n(${lastRunPointer})` : message;
  const lastRunRecordPath = lastRunPointer?.match(/record in (.+)$/)?.[1];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");

  let usage = null;
  try {
    for await (const event of askTutor({ message: fullMessage, projectDir: PROJECT_DIR, lastRunRecordPath })) {
      if (event.type === "text") {
        res.write(`data: ${JSON.stringify({ type: "text", value: event.text })}\n\n`);
      }
      if (event.type === "done") {
        usage = event.usage;
      }
    }
  } catch (err) {
    // Diagnostic: the SDK's own error message wraps the real underlying
    // spawn failure in a generic (and, on Windows, Linux-worded) string —
    // dumping every property the error object actually carries to find what
    // it's hiding, since String(err) alone hasn't been enough to diagnose
    // the packaged-app launch failure.
    console.error("TUTOR ERROR FULL:", JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
    res.write(`data: ${JSON.stringify({ type: "error", value: String(err) })}\n\n`);
  }

  if (usage) {
    await mkdir(path.dirname(USAGE_LOG), { recursive: true });
    await appendFile(USAGE_LOG, JSON.stringify({ at: new Date().toISOString(), usage }) + "\n");
  }
  res.end();
});

const httpServer = createServer(app);

// Run channel: WebSocket, matching Piston's own WebSocket contract — the
// frontend talks to this proxy, which talks to Piston. See runner.js.
const wss = new WebSocketServer({ server: httpServer, path: "/run" });

wss.on("connection", (ws) => {
  let session = null;

  ws.on("message", async (raw) => {
    const msg = JSON.parse(raw.toString());

    if (msg.type === "start") {
      const { filename, code } = msg;
      const ext = filename.split(".").pop();

      session = await runOnce({
        file: filename,
        ext,
        code,
        onData: ({ stream, text }) => ws.send(JSON.stringify({ type: "output", stream, text })),
        onExit: async ({ ok, output, error, preExecution }) => {
          ws.send(JSON.stringify({ type: "exit", ok, preExecution, error: preExecution ? error : undefined }));
          const record = await writeRunRecord({ filename, code, output, error });
          ws.send(JSON.stringify({ type: "run-recorded", ...record }));
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
const distDir = path.join(path.dirname(WORKSPACE_DIR), "frontend", "dist");
try {
  await import("node:fs").then((fs) => fs.accessSync(distDir));
  app.use(express.static(distDir));
  app.get(/^(?!\/api|\/run).*/, (_req, res) => res.sendFile(path.join(distDir, "index.html")));
} catch { /* dist not built — dev mode via Vite, nothing to do here */ }

const PORT = process.env.PORT || 4310;
httpServer.listen(PORT, () => console.log(`Backend on http://localhost:${PORT}`));
