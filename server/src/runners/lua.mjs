// Lua, built in: the official Lua 5.4 compiled to WebAssembly (wasmoon).
// print, io.write and io.read are routed to the real stdout/stdin.
// usage: node lua.mjs <file.lua>
import { readFileSync } from "node:fs";
import { LuaFactory } from "wasmoon";
import { createRequire } from "node:module";
const { readLine } = createRequire(import.meta.url)("./stdin-sync.cjs");
const file = process.argv[2];
const lua = await new LuaFactory().createEngine();
// print and io.write go straight to stdout; io.read reads a typed line.
lua.global.set("print", (...args) => process.stdout.write(args.map((a) => (a === null || a === undefined ? "nil" : String(a))).join("\t") + "\n"));
lua.global.set("__tu_write", (s) => process.stdout.write(String(s)));
lua.global.set("__tu_readline", () => { const l = readLine(); return l === null ? null : l.replace(/\r?\n$/, ""); });
await lua.doString(`
  local write, readline = __tu_write, __tu_readline
  io.write = function(...) for _, v in ipairs({...}) do write(tostring(v)) end return io end
  io.read = function(fmt)
    local line = readline()
    if line == nil then return nil end
    if fmt == "n" or fmt == "*n" then return tonumber(line) end
    return line
  end
`);
try { await lua.doString(readFileSync(file, "utf8")); }
catch (e) { process.stderr.write(String(e.message || e).replace(/^\[string "[^"]*"\]/, "line") + "\n"); process.exitCode = 1; }
finally { lua.global.close(); }
