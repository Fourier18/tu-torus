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

// qbjc's grammar reads `PRINT LEN("ab") + 1` two ways — as the function call,
// and as a variable LEN printed next to `("ab") + 1` — and then refuses the
// line with "2 parse trees". So any PRINT of a function call in a sum failed
// (PRINT VAL(x$) + 1, PRINT UBOUND(A) + 1). When the grammar allows several
// readings, take the one QBasic means: the most function calls/indexing,
// then the fewest bare names.
const parserModule = require("qbjc/dist/parser/parser");
const qbjcParse = parserModule.default;
parserModule.default = (input, opts) => {
  let results;
  try {
    const parser = parserModule.createParser(opts);
    parser.feed(input);
    parser.feed("\n");
    results = parser.results;
  } catch { return qbjcParse(input, opts); } // qbjc's own parse gives the readable syntax error
  if (results.length < 2) return results.length ? results[0] : qbjcParse(input, opts);
  const count = (s, re) => (s.match(re) ?? []).length;
  const score = (tree) => { const s = JSON.stringify(tree); return count(s, /"type":"fnCall"/g) * 10 - count(s, /"type":"varRef"/g); };
  return results.reduce((best, t) => (score(t) > score(best) ? t : best));
};

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
