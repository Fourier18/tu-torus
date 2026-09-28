// BASIC, built in: qbjc compiles QBasic/QuickBASIC (line numbers and GOTO
// included) to JavaScript and runs it. Its own Node platform assumes a real
// terminal (raw mode, cursor queries); PipePlatform swaps those for plain
// pipe I/O, which is what the app's output panel gives it.
// usage: node basic.cjs <file.bas>
const fs = require("fs");
const path = require("path");
const { compile } = require("qbjc");
const { default: Executor } = require("qbjc/dist/runtime/executor");
const { NodePlatform } = require("qbjc/dist/runtime/node-platform");
const { readLine } = require("./stdin-sync.cjs");

class PipePlatform extends NodePlatform {
  async inputLine() { return readLine() ?? ""; }
  async getChar() { return null; }
  async moveCursorTo() {}
  async setCursorVisibility() {}
  async clearScreen() {}
  async setFgColor() {}
  async setBgColor() {}
  async beep() {}
  async getCursorPosition() { return { x: 0, y: 0 }; }
  async getScreenSize() { return { rows: 25, cols: 80 }; }
}

(async () => {
  const file = process.argv[2];
  const source = fs.readFileSync(file, "utf8");
  let code;
  // qbjc has no graphics statements, so PSET etc. surfaced as baffling syntax
  // errors ("Unexpected NEWLINE token", "Unexpected COMMA") that a learner —
  // and the tutor — chased as punctuation for a dozen replies. Name the real
  // reason first. Strings are blanked so PRINT "PSET" doesn't count; LINE
  // counts only in its graphics form, LINE (x, y)-(x2, y2).
  const GRAPHICS = /\b(SCREEN|PSET|PRESET|CIRCLE|PAINT|DRAW|PALETTE|VIEW|WINDOW)\b|\bLINE\s*-?\s*\(/i;
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].replace(/"[^"]*("|$)/g, '""').replace(/'.*$|\bREM\b.*$/i, "").match(GRAPHICS);
    if (m) {
      const word = (m[1] || "LINE").toUpperCase();
      process.stderr.write(`${path.basename(file)} line ${i + 1}: ${word} is a graphics command. BASIC in Tu-Torus shows text only for now, so graphics commands (SCREEN, PSET, LINE, CIRCLE, PAINT, DRAW) can't run.\n`);
      process.exit(1);
    }
  }
  const plain = (msg) => msg
    .replace(/Unexpected NEWLINE token: "[^"]*"/g, "The line ended where more was expected")
    .replace(/Unexpected (\w+) token: "([^"]*)"/g, (_, _k, t) => `Unexpected "${t}" here`);
  try { ({ code } = await compile({ source, sourceFileName: path.basename(file) })); }
  catch (e) { process.stderr.write(plain(String(e.message || e)) + "\n"); process.exit(1); }
  try { await new Executor(new PipePlatform(), {}).executeModule(code); }
  catch (e) { process.stderr.write(String(e.message || e) + "\n"); process.exit(1); }
})();
