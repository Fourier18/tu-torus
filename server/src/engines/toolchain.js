// [Corrected plan] Runs an installed local compiler/interpreter as a plain
// subprocess. This app's real threat model isn't "defend a shared server
// from strangers" (that's what Piston/Judge0/Docker are actually for) — it's
// one person running their own code on their own machine, same as opening a
// terminal themselves. So the guards that actually matter are hygiene, not
// isolation: a hard timeout, the whole process tree killed on timeout (not
// just the parent — a compiler can spawn children that outlive it), capped
// output, and a fresh throwaway directory per run so file writes can't touch
// anything outside it.
import { spawn, execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TOOLS_DIR } from "../paths.js";

// The built-in language runners (server/src/runners) — languages.json refers
// to them as {runners}/<name>.
const RUNNERS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "runners");

const TIMEOUT_MS = 15000;
const MAX_OUTPUT = 200_000;

const installedCache = new Map();
function isInstalled(command) {
  if (installedCache.has(command)) return installedCache.get(command);
  const p = new Promise((resolve) => {
    execFile(process.platform === "win32" ? "where" : "which", [command], (err) => resolve(!err));
  });
  installedCache.set(command, p);
  return p;
}

// `minVersion`: some tools only run a lone file from a certain version on —
// `dotnet run app.cs` needs .NET 10; .NET 8 answers "Couldn't find a project
// to run", which tells a beginner nothing. Returns the installed version
// string when it's too old, else null.
const versionCache = new Map();
function tooOld(command, { args = ["--version"], major }) {
  const key = `${command} ${args.join(" ")}`;
  if (!versionCache.has(key)) {
    versionCache.set(key, new Promise((resolve) => {
      execFile(command, args, { timeout: 10000 }, (err, stdout) => {
        const v = String(stdout ?? "").match(/\d+(\.\d+)*/)?.[0];
        resolve(err || !v ? null : v);
      });
    }));
  }
  return versionCache.get(key).then((v) => (v && Number(v.split(".")[0]) < major ? v : null));
}

function fill(template, vars) {
  if (Array.isArray(template)) return template.map((t) => fill(t, vars));
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

function killTree(child) {
  if (process.platform === "win32") execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
  else child.kill("SIGKILL");
}

// Error output from programs run on the app's own Node (JavaScript,
// TypeScript, and the runners for the other languages) carried Node's
// internals: the temporary run folder in every path, eight "node:internal"
// stack frames, the runner's own frames and a "Node.js v24" line. A
// beginner (and the tutor reading the run) needs the message, the line and
// where in their file. One line at a time, so it works on streamed output.
export function nodeErrorTidier({ dir, name }) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const folder = new RegExp(esc(dir + path.sep), "gi");
  const folderUrl = new RegExp(esc(pathToFileURL(dir).href + "/"), "gi");
  const mts = name.endsWith(".ts") ? new RegExp(esc(name.replace(/\.ts$/, ".mts")), "g") : null;
  return (line) => {
    if (/^\s*at\b.*\bnode:internal\//.test(line)) return null;
    if (/^\s*at\b.*[\\/]server[\\/]src[\\/]runners[\\/]/.test(line) || /^\s*at\b.*\/server\/src\/runners\//.test(line)) return null;
    if (/^Node\.js v\d+\.\d+\.\d+\s*$/.test(line)) return null;
    let out = line.replace(folder, "").replace(folderUrl, "");
    if (mts) out = out.replace(mts, name);
    return out.replace(/^(\s*)at (?:Object\.)?<anonymous> \((.+)\)\s*$/, "$1at $2");
  };
}

// Runs one stage (compile or exec) to completion, streaming output live and
// enforcing the timeout/output cap. Returns {ok, timedOut, output, error}.
function runStage({ command, args, cwd, env, onData, getWrite, onChild, timeoutMs = TIMEOUT_MS, tidyErrors, echo = true }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env });
    onChild?.(child); // so Stop can reach the process that's actually running
    let output = "";
    let errorText = "";
    let outputLen = 0;
    let timedOut = false;
    let capped = false;
    // The limit is for runaway programs, not slow typists. The clock pauses
    // only when the program has gone quiet after a prompt (output ending
    // without a line break, e.g. "Name? ", then nothing for half a second —
    // it's waiting for input), and starts over when the learner types. A
    // plain wall clock had killed programs mid-INPUT while a beginner was
    // thinking; pausing on any line-break-less output let a loop printing
    // without line breaks run forever.
    let timer = null, quiet = null;
    const startClock = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs); };
    const stopClock = () => { clearTimeout(timer); timer = null; };
    startClock();

    // Error output passes through tidyErrors line by line (a partial last
    // line waits for the rest); doubled blank lines left by dropped ones go.
    let errCarry = "", lastBlank = false;
    const tidy = (text, final) => {
      const lines = (errCarry + text).split("\n");
      errCarry = final ? "" : lines.pop();
      const kept = [];
      for (const raw of lines) {
        const line = tidyErrors(raw.replace(/\r$/, ""));
        if (line === null) continue;
        const blank = !line.trim();
        if (blank && lastBlank) continue;
        lastBlank = blank;
        kept.push(line);
      }
      return kept.length ? kept.join("\n") + (final ? "" : "\n") : "";
    };

    const forward = (stream) => (chunk) => {
      outputLen += chunk.length;
      if (outputLen > MAX_OUTPUT) { capped = true; killTree(child); return; }
      const text = stream === "stderr" && tidyErrors ? tidy(chunk.toString(), false) : chunk.toString();
      if (stream === "stdout") output += text; else errorText += text;
      if (text) onData({ stream, text });
      clearTimeout(quiet);
      if (!timer) startClock();
      if (getWrite && stream === "stdout" && !text.endsWith("\n")) quiet = setTimeout(stopClock, 500);
    };
    child.stdout.on("data", forward("stdout"));
    child.stderr.on("data", forward("stderr"));

    // Typed input is echoed like a terminal would (see python.js write()).
    // Not for private checks: their answers are written before the program
    // asks, so the runner echoes each one as it's read (stdin-sync.cjs).
    if (getWrite) getWrite((text) => {
      const line = text.endsWith("\n") ? text : text + "\n";
      if (echo) {
        output += line;
        onData({ stream: "stdout", text: line });
      }
      child.stdin.write(line);
      startClock();
    });

    child.on("close", (code) => {
      clearTimeout(timer); clearTimeout(quiet);
      if (tidyErrors && errCarry) { const rest = tidy("", true); if (rest) { errorText += rest; onData({ stream: "stderr", text: rest }); } }
      resolve({ ok: code === 0 && !timedOut && !capped, timedOut, output, error: capped ? "Stopped — the program printed more than 200,000 characters (probably a loop that never ends)." : errorText });
    });
    child.on("error", (err) => { clearTimeout(timer); resolve({ ok: false, timedOut: false, output, error: err.message }); });
  });
}

// The server folder: the runners and the packages they load. A restricted
// run may read it, and nothing else outside its own throwaway folder.
const SERVER_DIR = path.join(RUNNERS_DIR, "..", "..");

// `restricted`: the tutor's private checks, which run the learner's file
// without them pressing Run. Since 1.5.0 the tutor can check Python, JS, TS
// and the other built-in languages that way, and JS/TS (and Python, through
// Pyodide's `js` module) otherwise get full access to the computer — pasted
// code could have read the API key, deleted files or started programs. Node's
// permission system limits reading and writing to the run folder (plus the
// server folder for reading), refuses child processes, workers, addons and
// process.binding; no-network.cjs turns off the network; the environment is
// cut to what Node needs, so no variables (keys, paths) leak in. The
// learner's own Run is left as it is: running their program is their choice,
// like running it in a terminal.
export function restrictedArgs(dir) {
  return ["--permission", `--allow-fs-read=${SERVER_DIR}`, `--allow-fs-read=${dir}`, `--allow-fs-write=${dir}`, "--allow-wasi", "--no-warnings",
    "--require", path.join(RUNNERS_DIR, "no-network.cjs"), "--require", path.join(RUNNERS_DIR, "restricted-compat.cjs")];
}
export function restrictedEnv(dir) {
  const env = { ELECTRON_RUN_AS_NODE: "1", TEMP: dir, TMP: dir, TU_TORUS_ECHO_INPUT: "1" }; // see stdin-sync.cjs
  for (const key of ["SystemRoot", "SYSTEMROOT", "windir"]) if (process.env[key]) env[key] = process.env[key];
  return env;
}

export async function runToolchain({ filename, code, config: rawConfig, onData, onExit, restricted = false }) {
  // Only languages that run on the app's own Node, in one stage, can be
  // restricted this way; anything else is never run privately.
  if (restricted && (!rawConfig.bundledNode || rawConfig.compile)) {
    onExit({ ok: false, preExecution: true, error: "This language can't be checked privately." });
    return { write: () => {}, kill: () => {} };
  }
  // `bundledNode`: run on the Node that's already running this server —
  // Electron's own copy in the installed app (ELECTRON_RUN_AS_NODE makes
  // electron.exe behave as plain Node), real node in dev. So .js needs no
  // separate Node.js install.
  const config = rawConfig.bundledNode ? { ...rawConfig, command: process.execPath } : rawConfig;
  let env = { ...process.env, ...(rawConfig.bundledNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}), ...(rawConfig.env ?? {}) };

  const ext = filename.split(".").pop();
  const what = config.installName || config.command;
  const where = config.installUrl ? ` Get it here: ${config.installUrl}` : "";
  if (!rawConfig.bundledNode && !(await isInstalled(config.command))) {
    onExit({ ok: false, preExecution: true, error: `To run .${ext} files, this computer needs ${what} installed (the \`${config.command}\` command wasn't found).${where}` });
    return { write: () => {}, kill: () => {} };
  }
  const old = config.minVersion ? await tooOld(config.command, config.minVersion) : null;
  if (old) {
    onExit({ ok: false, preExecution: true, error: `To run .${ext} files, this computer needs ${what} — it has version ${old}, which is too old.${where}` });
    return { write: () => {}, kill: () => {} };
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), "tu-torus-run-")); // fresh, throwaway — this is the isolation that actually matters here
  const filePath = path.join(dir, path.basename(filename)); // never outside the throwaway dir, whatever the caller passed
  const outPath = path.join(dir, "a.out" + (process.platform === "win32" ? ".exe" : ""));
  const classname = path.basename(filename, path.extname(filename));
  const vars = { file: filePath, out: outPath, dir, classname, runners: RUNNERS_DIR, tools: TOOLS_DIR, node: process.execPath, name: path.basename(filename) };
  await writeFile(filePath, code);
  if (restricted) env = restrictedEnv(dir);

  // Lines typed before the program is running (while it compiles, or while
  // the compiler sets itself up) wait here instead of being dropped.
  let stdinWriter = null;
  const typedEarly = [];
  let inputEnded = false; // end(): no more input after what's queued — the program reads end-of-input instead of waiting
  let killed = false; // Stop pressed: end the running stage (compile or program) and don't start another
  let current = null;
  const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => {});

  (async () => {
    if (config.compile) {
      // compileTimeout: a first-use setup (the C/C++ compiler download) needs
      // longer than a program run gets.
      const compileResult = await runStage({ command: config.command, args: fill(config.compile, vars), cwd: dir, env, onData, onChild: (c) => { current = c; }, timeoutMs: config.compileTimeout });
      if (!compileResult.ok) {
        await cleanup();
        onExit({ ok: false, error: killed ? "Stopped." : compileResult.timedOut ? "Compile timed out." : compileResult.error });
        return;
      }
    }

    if (killed) { await cleanup(); onExit({ ok: false, error: "Stopped." }); return; }

    const execCommand = config.execCommand ? fill(config.execCommand, vars) : (config.exec ? fill(config.exec, vars) : config.command);
    let execArgs = config.execArgs ? fill(config.execArgs, vars) : (config.exec ? [] : fill(config.args, vars));
    if (restricted) execArgs = [...restrictedArgs(dir), ...execArgs];

    const result = await runStage({
      command: execCommand,
      args: execArgs,
      cwd: dir,
      env,
      onData,
      onChild: (c) => { current = c; },
      getWrite: (write) => { stdinWriter = write; for (const t of typedEarly.splice(0)) write(t); if (inputEnded) current?.stdin.end(); },
      tidyErrors: rawConfig.bundledNode ? nodeErrorTidier({ dir, name: path.basename(filename) }) : undefined,
      echo: !restricted,
    });

    await cleanup();
    onExit({ ok: result.ok, output: result.output, error: killed ? "Stopped." : result.timedOut ? "Timed out — stopped after 15 seconds." : (result.error || null) });
  })();

  return {
    write: (text) => (stdinWriter ? stdinWriter(text) : typedEarly.push(text)),
    end: () => { inputEnded = true; if (stdinWriter) current?.stdin.end(); },
    kill: () => { killed = true; if (current && current.exitCode === null) killTree(current); },
  };
}
