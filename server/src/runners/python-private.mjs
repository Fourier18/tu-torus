// Python for the tutor's private checks only (the learner's own Run uses
// engines/python.js). The learner's Run loads Pyodide in a worker inside the
// app's server process, where Python can reach Node through Pyodide's `js`
// module. A private check must not have that reach, so it runs here instead:
// a separate process started with Node's permission system and the network
// turned off (toolchain.js `restricted`), like every other language's check.
// usage: node python-private.mjs <file.py>
import { readFileSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { loadPyodide } from "pyodide";

const { readLine } = createRequire(import.meta.url)("./stdin-sync.cjs");
const code = readFileSync(process.argv[2], "utf8");

// Told where its files are (see python-worker.js: brackets in the install
// path broke Pyodide's own guess).
const indexURL = path.dirname(createRequire(import.meta.url).resolve("pyodide")) + path.sep;
const pyodide = await loadPyodide({ indexURL });
// isatty: CPython only flushes input()'s prompt before reading when stdout
// looks like a terminal (same reason as python-worker.js).
pyodide.setStdout({ write: (buf) => writeSync(1, buf), isatty: true });
pyodide.setStderr({ write: (buf) => writeSync(2, buf), isatty: true });
pyodide.setStdin({ stdin: () => readLine() });

try {
  await pyodide.runPythonAsync(code);
} catch (err) {
  // Pyodide's own internal frames come before the learner's; keep theirs.
  writeSync(2, String(err.message || err).replace(/Traceback \(most recent call last\):\n[\s\S]*?(?=  File "<exec>")/g, "Traceback (most recent call last):\n"));
  process.exitCode = 1;
}
