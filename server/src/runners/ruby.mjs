// Ruby, built in: CRuby compiled to WebAssembly (ruby.wasm), run on the
// Node the app already carries. `gets` reads the real stdin through WASI, so
// a program waits for typed input like it would in a terminal.
// usage: node ruby.mjs <file.rb>
import { readFile } from "node:fs/promises";
import { WASI } from "node:wasi";
import path from "node:path";
import { createRequire } from "node:module";
import { RubyVM } from "@ruby/wasm-wasi/dist/vm";

const require = createRequire(import.meta.url);
const wasmPath = require.resolve("@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm");
const file = path.resolve(process.argv[2]);
const name = path.basename(file);

const wasi = new WASI({ version: "preview1", env: {}, returnOnExit: true, stdin: 0, stdout: 1, stderr: 2 });
const module = await WebAssembly.compile(await readFile(wasmPath));
const { vm } = await RubyVM.instantiateModule({ module, wasip1: wasi });

// eval with the file's own name and line 1, so errors read "main.rb:2: ..."
// rather than pointing into this wrapper. Single-quoted Ruby string: only \
// and ' need escaping.
const src = await readFile(file, "utf8");
const quoted = "'" + src.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
vm.eval(`
$stdout.sync = true
$0 = ${JSON.stringify(name)}
$tu_status = 0
begin
  eval(${quoted}, TOPLEVEL_BINDING, ${JSON.stringify(name)}, 1)
rescue SystemExit => e
  $tu_status = e.status
rescue ScriptError, StandardError => e
  where = e.is_a?(SyntaxError) ? nil : (e.backtrace || []).find { |l| l.start_with?(${JSON.stringify(name)}) }
  where = where && where[/\\A[^:]+:\\d+/]
  $stderr.puts(where ? "#{where}: #{e.message} (#{e.class})" : "#{e.message} (#{e.class})")
  $tu_status = 1
end
`);
process.exitCode = Number(vm.eval("$tu_status").toString()) || 0;
