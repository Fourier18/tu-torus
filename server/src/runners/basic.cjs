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
  try { ({ code } = await compile({ source, sourceFileName: path.basename(file) })); }
  catch (e) { process.stderr.write(String(e.message || e) + "\n"); process.exit(1); }
  try { await new Executor(new PipePlatform(), {}).executeModule(code); }
  catch (e) { process.stderr.write(String(e.message || e) + "\n"); process.exit(1); }
})();
