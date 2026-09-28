// TypeScript, built in: type-checked with the TypeScript compiler, then run
// by the app's own Node with the types removed. Needs Node's
// --experimental-transform-types flag (for enums) — languages.json passes it.
// usage: node --experimental-transform-types ts.mjs <file.ts>
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const file = path.resolve(process.argv[2]);
const name = path.basename(file);

// Type definitions: server/ts-types in the installed app, stored as
// *.d.ts.txt because the installer drops every .d.ts file (see
// scripts/copy-ts-types.cjs); the packages themselves in development.
const shipped = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "ts-types");
const useShipped = existsSync(shipped);
const libDir = useShipped ? path.join(shipped, "lib") : path.dirname(require.resolve("typescript"));
const typeRoot = useShipped ? path.join(shipped, "types") : path.join(path.dirname(require.resolve("@types/node/package.json")), "..");
const shippedKey = path.resolve(shipped).replace(/\\/g, "/").toLowerCase();
const onDisk = (p) => (useShipped && p.endsWith(".d.ts") && path.resolve(p).replace(/\\/g, "/").toLowerCase().startsWith(shippedKey) ? p + ".txt" : p);

// Type-check first, like tsc: type errors are what TypeScript is for, and
// Node on its own would just strip the types and run anyway.
const options = {
  noEmit: true, strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  types: ["node"], typeRoots: [typeRoot], skipLibCheck: true, moduleDetection: ts.ModuleDetectionKind.Force,
};
const host = ts.createCompilerHost(options);
const { fileExists, readFile, getSourceFile } = host;
host.fileExists = (p) => fileExists.call(host, onDisk(p));
host.readFile = (p) => readFile.call(host, onDisk(p));
host.getSourceFile = (p, ...rest) => {
  const text = readFile.call(host, onDisk(p));
  return text === undefined ? getSourceFile.call(host, p, ...rest) : ts.createSourceFile(p, text, rest[0], false);
};
host.getDefaultLibLocation = () => libDir;
host.getDefaultLibFileName = (o) => path.join(libDir, ts.getDefaultLibFileName(o));
const program = ts.createProgram([file], options, host);
const diags = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error);
if (diags.length) {
  for (const d of diags) {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    if (d.file) { const { line, character } = d.file.getLineAndCharacterOfPosition(d.start); process.stderr.write(`${name} line ${line + 1}, column ${character + 1}: ${msg}\n`); }
    else process.stderr.write(msg + "\n");
  }
  process.exit(1);
}
// Run it as a module (so import and top-level await work), types removed by Node.
require("./prompt.cjs"); // prompt()/alert() for the learner's file, as for .js
const mts = file.replace(/\.ts$/, ".mts");
copyFileSync(file, mts);
await import(pathToFileURL(mts).href);
