// Odd-path check: run by hand against a copy of the built app placed in a
// folder named like "Jöhn Smith, Jr (Prüfung)", with TUTORUS_DATA_DIR and
// TEMP inside it:  ELECTRON_RUN_AS_NODE=1 <copy>/Tu-Torus.exe server/test/odd-path.check.mjs <copy>/resources/app/server/src
// Runs inside the copied app (its own Tu-Torus.exe as Node), with the data
// folder and TEMP under a path that has a space, accents, a comma and
// brackets — the kind of Windows username that breaks file paths.
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";

const src = process.argv[2];
const { runOnce } = await import(pathToFileURL(path.join(src, "runner.js")).href);
const { tutorTools } = await import(pathToFileURL(path.join(src, "tutor.js")).href);
console.log("TEMP is", os.tmpdir());

const programs = {
  py: ['n = input("Name? ")\nprint("Hi " + n)\n', "Hi Ada"],
  js: ['const n = prompt("Name?");\nconsole.log("Hi " + n);\n', "Hi Ada"],
  ts: ['const n: string | null = prompt("Name?");\nconsole.log("Hi " + n);\n', "Hi Ada"],
  rb: ['n = gets.chomp\nputs "Hi #{n}"\n', "Hi Ada"],
  php: ['<?php\n$n = trim(fgets(STDIN));\necho "Hi $n\\n";\n', "Hi Ada"],
  pl: ['my $n = <STDIN>; chomp $n; print "Hi $n\\n";\n', "Hi Ada"],
  lua: ['local n = io.read()\nprint("Hi " .. n)\n', "Hi Ada"],
  bas: ['INPUT "Name"; N$\nPRINT "Hi "; N$\n', "Hi Ada"],
  c: ['#include <stdio.h>\nint main(void) { char n[32]; scanf("%31s", n); printf("Hi %s\\n", n); return 0; }\n', "Hi Ada"],
  cpp: ['#include <iostream>\n#include <string>\nint main() { std::string n; std::cin >> n; std::cout << "Hi " << n << "\\n"; }\n', "Hi Ada"],
  json: ['{"name": "Ada"}', "Valid JSON."],
};

let failed = 0;
const run = (ext, code) => new Promise((resolve) => {
  let out = "";
  runOnce({ file: `main.${ext}`, ext, code, onData: (d) => (out += d.text), onExit: (e) => resolve({ ...e, out }) })
    .then((s) => setTimeout(() => s.write("Ada"), 1500));
});
for (const [ext, [code, want]] of Object.entries(programs)) {
  const r = await run(ext, code);
  const ok = r.out.includes(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  Run .${ext}${ok ? "" : `  ${JSON.stringify(r.out.slice(0, 200))} ${String(r.error ?? "").slice(0, 300)}`}`);
}
for (const ext of ["py", "js", "ts", "rb", "php", "pl", "lua", "bas"]) {
  const r = await tutorTools({ filename: `main.${ext}`, code: programs[ext][0] }).runTool("run_learner_code", { inputs: ["Ada"] });
  const ok = r.screen.includes("Hi Ada");
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  private check .${ext}${ok ? "" : `  ${JSON.stringify(r)}`}`);
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
