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
// not the file contents — per [DESIGN.md]: the tutor reads run files itself.
app.post("/api/tutor", async (req, res) => {
  const { message, lastRunPointer } = req.body;
  const fullMessage = lastRunPointer ? `${message}\n\n(${lastRunPointer})` : message;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");

  let usage = null;
  try {
    for await (const event of askTutor({ message: fullMessage, projectDir: PROJECT_DIR })) {
      if (event.type === "assistant") {
        res.write(`data: ${JSON.stringify({ type: "text", value: event.message.content })}\n\n`);
      }
      if (event.type === "result") {
        usage = event.usage;
      }
    }
  } catch (err) {
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

const PORT = process.env.PORT || 4310;
httpServer.listen(PORT, () => console.log(`Backend on http://localhost:${PORT}`));
