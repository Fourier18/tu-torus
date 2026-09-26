// Runs before packaging. electron-builder leaves every .d.ts file out of the
// installer (in or out of node_modules, whatever the files rules say), but
// those are the type definitions the built-in TypeScript checker
// needs: the standard library's types, and Node's for readline/process.
// Copy them to server/ts-types/ renamed *.d.ts.txt, which the installer keeps;
// server/src/runners/ts.mjs reads them from there.
const fs = require("fs");
const path = require("path");

const server = path.join(__dirname, "..", "server");
const out = path.join(server, "ts-types");
fs.rmSync(out, { recursive: true, force: true });

const libSrc = path.join(server, "node_modules", "typescript", "lib");
fs.mkdirSync(path.join(out, "lib"), { recursive: true });
for (const f of fs.readdirSync(libSrc)) {
  if (/^lib\..*\.d\.ts$/.test(f)) fs.copyFileSync(path.join(libSrc, f), path.join(out, "lib", f + ".txt"));
}

const nodeSrc = path.join(server, "node_modules", "@types", "node");
const copyTypes = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyTypes(a, b);
    else if (e.name.endsWith(".d.ts")) fs.copyFileSync(a, b + ".txt");
    else if (e.name === "package.json") fs.copyFileSync(a, b);
  }
};
copyTypes(nodeSrc, path.join(out, "types", "node"));
console.log("TypeScript type definitions copied to server/ts-types");
