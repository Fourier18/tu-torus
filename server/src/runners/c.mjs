// C and C++, set up on first use: Clang/LLD compiled to WebAssembly (YoWASP),
// downloaded once from npm into the app's tools folder (about 27 MB), checked
// against npm's published SHA-512, then used offline. The program it builds
// is plain WASI and runs on the app's own Node, reading typed input from stdin.
// usage: node c.mjs compile <source> <out.wasm> <tools dir>
//        node c.mjs run <out.wasm> <program name>
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { WASI } from "node:wasi";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CLANG = {
  version: "22.0.0-git20542-10",
  // TU_TORUS_CLANG_URL: tests point this somewhere unreachable to check
  // what a learner sees with no internet.
  url: process.env.TU_TORUS_CLANG_URL || "https://registry.npmjs.org/@yowasp/clang/-/clang-22.0.0-git20542-10.tgz",
  sha512: "V31/z9GrJECKeACTDUyvg2llbEUiFi3bxtL5HSg7H/6sydSxdI/AoVAD9F5ozrfLjotWl0B9rghR87m+DUM/zg==",
};

// A download that goes quiet (no data for STALL_MS) is given up on, rather
// than sitting until the 10-minute compile limit. (Defined before the
// top-level await below, which starts the download.)
const STALL_MS = Number(process.env.TU_TORUS_DOWNLOAD_STALL_MS) || 60_000;

const [mode, ...args] = process.argv.slice(2);
if (mode === "compile") await compile(...args);
else if (mode === "run") await run(...args);

async function compile(source, out, toolsDir) {
  const name = path.basename(source);
  const cxx = /\.(cpp|cc|cxx)$/i.test(name);
  const home = await ensureClang(toolsDir);
  // The YoWASP runtime logs "yowasp-llvm: fetched N%" as it loads the
  // compiler from disk on every compile — noise in a beginner's output panel.
  for (const k of ["log", "info", "error", "warn"]) {
    const orig = console[k];
    console[k] = (...a) => { if (!String(a[0] ?? "").startsWith("yowasp-")) orig(...a); };
  }
  const { runClang } = await import(pathToFileURL(path.join(home, "gen", "bundle.js")).href);
  let messages = "";
  const collect = (bytes) => { if (bytes) messages += Buffer.from(bytes).toString("utf8"); };
  try {
    // -fno-exceptions: this toolchain has no C++ exception runtime, and
    // without it any use of the standard containers fails to link.
    const files = await runClang([cxx ? "clang++" : "clang", ...(cxx ? ["-fno-exceptions"] : []), name, "-o", "prog.wasm"],
      { [name]: readFileSync(source, "utf8") }, { stdout: collect, stderr: collect, fetchProgress: () => {} });
    if (messages.trim()) process.stderr.write(messages); // warnings
    writeFileSync(out, files["prog.wasm"]);
  } catch (e) {
    process.stderr.write(messages.trim() ? messages : `${e.message}\n`);
    process.exitCode = 1;
  }
}

async function run(wasmFile, name = "program") {
  const wasi = new WASI({ version: "preview1", args: [name], env: {}, returnOnExit: true, stdin: 0, stdout: 1, stderr: 2 });
  const module = await WebAssembly.compile(await readFile(wasmFile));
  const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });
  try { process.exitCode = wasi.start(instance); }
  catch (e) {
    // A crash (reading past an array, a bad pointer, dividing by zero) —
    // say so in plain words rather than print a WebAssembly stack trace.
    if (!(e instanceof WebAssembly.RuntimeError)) throw e;
    process.stderr.write(`The program crashed: ${e.message}. That usually means reading or writing outside an array, using a bad pointer, or dividing by zero.\n`);
    process.exitCode = 1;
  }
}

// Downloads and unpacks the compiler the first time; afterwards just returns
// where it is. Unpacks to a temporary folder and renames it into place, so an
// interrupted download never leaves a half-installed compiler behind.
async function ensureClang(toolsDir) {
  const home = path.join(toolsDir, `clang-${CLANG.version}`);
  if (existsSync(path.join(home, "gen", "bundle.js"))) return home;
  mkdirSync(toolsDir, { recursive: true });
  process.stdout.write("Setting up the C/C++ compiler — a one-time download of about 27 MB. After this, C and C++ run offline.\n");
  let tgz;
  try { tgz = await download(CLANG.url); }
  catch (e) {
    // Network error codes in plain words; anything else as it came.
    const code = e.code ?? e.cause?.code;
    const why = ["ENOTFOUND", "EAI_AGAIN"].includes(code) ? "the download site couldn't be reached — this computer may be offline"
      : ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"].includes(code) ? "the connection was refused or dropped"
        : /^HTTP \d+/.test(e.message) ? `the download site answered with an error (${e.message})`
          : e.message;
    process.stderr.write(`Couldn't download the C/C++ compiler (${why}). Check the internet connection and press Run again — it's only needed this once. On a school or office network, a proxy or firewall may be blocking it.\n`);
    process.exit(1);
  }
  const digest = createHash("sha512").update(tgz).digest("base64");
  if (digest !== CLANG.sha512) {
    process.stderr.write("The downloaded C/C++ compiler didn't match its published fingerprint, so it wasn't used. Press Run to try again.\n");
    process.exit(1);
  }
  const staging = `${home}.partial-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  for (const { name, data } of untar(gunzipSync(tgz))) {
    const rel = name.replace(/^package\//, "");
    if (!rel || rel.includes("..")) continue;
    const dest = path.join(staging, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, data);
  }
  try { renameSync(staging, home); }
  catch { rmSync(staging, { recursive: true, force: true }); } // another run finished first
  process.stdout.write("Compiler ready.\n");
  return home;
}

async function download(url) {
  const abort = new AbortController();
  const stalled = () => abort.abort(new Error("the download stopped responding"));
  let stall = setTimeout(stalled, STALL_MS);
  const gotData = () => { clearTimeout(stall); stall = setTimeout(stalled, STALL_MS); };
  try {
    return await fetchAll(url, abort.signal, gotData);
  } catch (e) {
    throw abort.signal.aborted ? abort.signal.reason : e.cause ?? e;
  } finally {
    clearTimeout(stall);
  }
}

async function fetchAll(url, signal, onData) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 27_000_000;
  const chunks = [];
  let got = 0, shown = 0;
  for await (const chunk of res.body) {
    onData();
    chunks.push(chunk);
    got += chunk.length;
    const pct = Math.min(100, Math.floor((got / total) * 100));
    if (pct >= shown + 20) { shown = pct - (pct % 20); process.stdout.write(`  downloading… ${shown}%\n`); }
  }
  return Buffer.concat(chunks);
}

// Minimal tar reader (ustar, with pax/GNU long-name records) — enough for an
// npm package tarball.
function* untar(buf) {
  let longName = null;
  for (let off = 0; off + 512 <= buf.length;) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const str = (a, b) => header.subarray(a, b).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(str(124, 136).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = str(345, 500);
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") { longName = data.toString("utf8").replace(/\0.*$/s, ""); continue; }
    if (type === "x") { const m = /\d+ path=([^\n]*)\n/.exec(data.toString("utf8")); if (m) longName = m[1]; continue; }
    if (type === "g") continue;
    const name = longName ?? (prefix ? `${prefix}/${str(0, 100)}` : str(0, 100));
    longName = null;
    if (type === "0" || type === "\0") yield { name, data };
  }
}
