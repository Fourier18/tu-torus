// PHP, built in: PHP 8.4 compiled to WebAssembly (php-wasm), embed build.
// usage: node php.mjs <file.php>
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PhpNode } from "php-wasm/PhpNode.mjs";
const { readLine } = createRequire(import.meta.url)("./stdin-sync.cjs");
const file = process.argv[2];
const name = path.basename(file);

// PHP's STDIN pulls bytes one at a time until it gets null. Hand over one
// typed line, then null so the read returns — otherwise fgets() sits waiting
// for the whole input to end. Output is flushed before each wait, so a
// prompt shows before the program blocks.
let inBytes = [], lineDone = false;
let outBytes = [], errBytes = [];
const tidy = (b) => Buffer.from(b).toString("utf8").replaceAll("php-wasm run script", name);
const flush = () => {
  if (outBytes.length) { process.stdout.write(tidy(outBytes)); outBytes = []; }
  if (errBytes.length) { process.stderr.write(tidy(errBytes)); errBytes = []; }
};
const php = new PhpNode({
  version: "8.4",
  stdin: () => {
    if (!inBytes.length) {
      if (lineDone) { lineDone = false; return null; }
      flush();
      const line = readLine();
      if (line === null) return null;
      inBytes = [...Buffer.from(line, "utf8")];
    }
    const b = inBytes.shift();
    if (!inBytes.length) lineDone = true;
    return b;
  },
  stdout: (b) => { outBytes.push(b); if (b === 10) flush(); },
  stderr: (b) => { errBytes.push(b); if (b === 10) flush(); },
});

// The embed build has no CLI constants or readline(). They're defined in a
// run of their own first (definitions persist between runs), so the
// learner's file is run exactly as written and line numbers stay true.
const SETUP = `<?php
if (!defined('STDIN')) { define('STDIN', fopen('php://stdin', 'r')); define('STDOUT', fopen('php://stdout', 'w')); define('STDERR', fopen('php://stderr', 'w')); }
if (!function_exists('readline')) { function readline($prompt = null) { if ($prompt !== null) { echo $prompt; } $l = fgets(STDIN); return $l === false ? false : rtrim($l, "
"); } }`;
const code = readFileSync(file, "utf8");
await php.run(SETUP);
try {
  const exit = await php.run(code);
  flush();
  process.exitCode = exit ? 1 : 0;
} catch (e) { flush(); process.stderr.write(String(e.message || e) + "\n"); process.exitCode = 1; }
