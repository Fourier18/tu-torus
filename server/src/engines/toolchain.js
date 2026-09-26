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

function fill(template, vars) {
  if (Array.isArray(template)) return template.map((t) => fill(t, vars));
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

function killTree(child) {
  if (process.platform === "win32") execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
  else child.kill("SIGKILL");
}

// Runs one stage (compile or exec) to completion, streaming output live and
// enforcing the timeout/output cap. Returns {ok, timedOut, output, error}.
function runStage({ command, args, cwd, onData, getWrite }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd });
    let output = "";
    let errorText = "";
    let outputLen = 0;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, TIMEOUT_MS);

    const forward = (stream) => (chunk) => {
      outputLen += chunk.length;
      if (outputLen > MAX_OUTPUT) { killTree(child); return; }
      const text = chunk.toString();
      if (stream === "stdout") output += text; else errorText += text;
      onData({ stream, text });
    };
    child.stdout.on("data", forward("stdout"));
    child.stderr.on("data", forward("stderr"));

    // Typed input is echoed like a terminal would (see python.js write()).
    if (getWrite) getWrite((text) => {
      const line = text.endsWith("\n") ? text : text + "\n";
      output += line;
      onData({ stream: "stdout", text: line });
      child.stdin.write(line);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, timedOut, output, error: errorText });
    });
    child.on("error", (err) => { clearTimeout(timer); resolve({ ok: false, timedOut: false, output, error: err.message }); });
  });
}

export async function runToolchain({ filename, code, config, onData, onExit }) {
  if (!(await isInstalled(config.command))) {
    onExit({ ok: false, preExecution: true, error: `${config.command} isn't installed, or isn't on your PATH. Install it to run .${filename.split(".").pop()} files.` });
    return { write: () => {}, kill: () => {} };
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), "tu-torus-run-")); // fresh, throwaway — this is the isolation that actually matters here
  const filePath = path.join(dir, filename);
  const outPath = path.join(dir, "a.out" + (process.platform === "win32" ? ".exe" : ""));
  const classname = path.basename(filename, path.extname(filename));
  const vars = { file: filePath, out: outPath, dir, classname };
  await writeFile(filePath, code);

  let stdinWriter = null;
  let killed = false; // known gap: this only prevents starting the *next* stage — it can't reach a child process that's mid-compile when kill() is called, since runStage doesn't expose it outward. Not reachable from the UI today (no stop button built yet); worth a real fix if one is added.
  const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => {});

  (async () => {
    if (config.compile) {
      const compileResult = await runStage({ command: config.command, args: fill(config.compile, vars), cwd: dir, onData });
      if (!compileResult.ok) {
        await cleanup();
        onExit({ ok: false, error: compileResult.timedOut ? "Compile timed out." : compileResult.error });
        return;
      }
    }

    if (killed) { await cleanup(); return; }

    const execCommand = config.execCommand ? fill(config.execCommand, vars) : (config.exec ? fill(config.exec, vars) : config.command);
    const execArgs = config.execArgs ? fill(config.execArgs, vars) : (config.exec ? [] : fill(config.args, vars));

    const result = await runStage({
      command: execCommand,
      args: execArgs,
      cwd: dir,
      onData,
      getWrite: (write) => { stdinWriter = write; },
    });

    await cleanup();
    onExit({ ok: result.ok, output: result.output, error: result.timedOut ? "Timed out — stopped after 15 seconds." : (result.error || null) });
  })();

  return {
    write: (text) => stdinWriter?.(text),
    kill: () => { killed = true; },
  };
}
