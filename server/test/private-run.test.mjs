// The tutor's private checks run as restricted subprocesses (toolchain.js
// `restricted`, runner.js runPrivately). This checks that the restriction is
// actually applied — the permission flags and the cut-down environment — and
// that the ordinary checks the tutor relies on still work under it, in every
// language it can check.
//
// usage: node server/test/private-run.test.mjs
//        SERVER_SRC=<an installed app's resources/app/server/src> <Tu-Torus.exe with ELECTRON_RUN_AS_NODE=1> server/test/private-run.test.mjs
import path from "node:path";
import os from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.env.SERVER_SRC || path.join(here, "..", "src");
const load = (p) => import(pathToFileURL(path.join(src, p)).href);
const { tutorTools } = await load("tutor.js");
const { restrictedArgs, restrictedEnv } = await load("engines/toolchain.js");

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`); if (!ok) failed++; };

// The restriction itself.
const dir = path.join(os.tmpdir(), "tu-torus-run-example");
const args = restrictedArgs(dir);
const serverDir = path.resolve(src, "..");
check("permission system on", args.includes("--permission"));
check("reads limited to the server folder and the run folder", args.filter((a) => a.startsWith("--allow-fs-read=")).map((a) => path.resolve(a.slice(a.indexOf("=") + 1))).sort().join("|") === [serverDir, dir].map((p) => path.resolve(p)).sort().join("|"), JSON.stringify(args));
check("writes limited to the run folder", args.filter((a) => a.startsWith("--allow-fs-write=")).map((a) => path.resolve(a.slice(a.indexOf("=") + 1))).join("|") === path.resolve(dir), JSON.stringify(args));
check("no child processes, workers or addons granted", !args.some((a) => /^--allow-(child-process|worker|addons|inspector)/.test(a)));
const preloads = args.filter((a, i) => args[i - 1] === "--require").map((a) => path.basename(a));
check("network off and compatibility preload loaded", preloads.join(",") === "no-network.cjs,restricted-compat.cjs", preloads.join(","));
const env = restrictedEnv(dir);
check("environment cut to what Node needs", Object.keys(env).every((k) => ["ELECTRON_RUN_AS_NODE", "TEMP", "TMP", "SystemRoot", "SYSTEMROOT", "windir", "TU_TORUS_ECHO_INPUT"].includes(k)), Object.keys(env).join(","));

// Ordinary checks still work.
const run = async (filename, code, inputs = []) => {
  const t = tutorTools({ filename, code });
  if (!t.tools) return null;
  const started = Date.now();
  const r = await t.runTool("run_learner_code", { inputs });
  return { ...r, ms: Date.now() - started };
};
const cases = [
  ["main.py", 'print("hello")\n', [], (r) => r.screen.includes("hello") && !r.error],
  ["main.py", 'n = input("Name? ")\nprint("Hi " + n)\n', ["Ada"], (r) => r.screen.includes("Hi Ada")],
  ["main.js", 'console.log("hello")\n', [], (r) => r.screen.includes("hello") && !r.error],
  ["main.js", 'const n = prompt("Name?");\nconsole.log("Hi " + n);\n', ["Ada"], (r) => r.screen.includes("Hi Ada")],
  ["main.js", 'const fs = require("fs");\nfs.writeFileSync("notes.txt", "saved");\nconsole.log(fs.readFileSync("notes.txt", "utf8"));\n', [], (r) => r.screen.includes("saved") && !r.error],
  ["main.ts", 'const n: number = 2;\nconsole.log(n * 21);\n', [], (r) => r.screen.includes("42") && !r.error],
  ["main.ts", 'const n: number = "two";\n', [], (r) => /line 1/.test(r.error ?? "")],
  ["main.rb", 'puts "hello"\n', [], (r) => r.screen.includes("hello") && !r.error],
  ["main.rb", 'n = gets.chomp\nputs "Hi #{n}"\n', ["Ada"], (r) => r.screen.includes("Hi Ada")],
  ["main.php", '<?php\necho "hello\\n";\n', [], (r) => r.screen.includes("hello")],
  ["main.pl", 'print "hello\\n";\n', [], (r) => r.screen.includes("hello") && !r.error],
  ["main.lua", 'print("hello")\n', [], (r) => r.screen.includes("hello") && !r.error],
  ["main.bas", '10 PRINT "HELLO"\n', [], (r) => r.screen.includes("HELLO") && !r.error],
  ["main.json", '{"a": 1,}', [], (r) => /comma after the last item/.test(r.error ?? "")],
];
for (const [filename, code, inputs, ok] of cases) {
  const r = await run(filename, code, inputs);
  check(`private check: ${filename} ${JSON.stringify(code.split("\n")[0]).slice(0, 40)}`, r && ok(r), JSON.stringify(r));
}
// Typed answers appear where the program reads them, as on the learner's own
// screen — not all above the first prompt, where they used to land
// (2026-10-08: the tutor compared that screen with the learner's and argued
// about where blank lines fell). Ruby reads stdin through WASI, which the
// echo can't reach, so its answers aren't shown and the result says so.
const placed = [
  ["main.py", 'print("Q:")\nprint()\nn = input()\nprint()\nprint("got", n)\nm = input("Name? ")\nprint("Hi " + m)\n', (s) => s === "Q:\n\n-2\n\ngot -2\nName? Ada\nHi Ada\n"],
  ["main.js", 'console.log("Q:");\nconsole.log();\nconst n = prompt();\nconsole.log();\nconsole.log("got", n);\nconst m = prompt("Name? ");\nconsole.log("Hi " + m);\n', (s) => /^Q:\n\n-2\n\ngot -2\nName\? +Ada\nHi Ada\n$/.test(s)],
  ["main.lua", 'print("Q:")\nprint()\nlocal n = io.read()\nprint()\nprint("got", n)\nio.write("Name? ")\nlocal m = io.read()\nprint("Hi " .. m)\n', (s) => s === "Q:\n\n-2\n\ngot\t-2\nName? Ada\nHi Ada\n"],
  ["main.php", '<?php\necho "Q:\\n";\n$n = trim(fgets(STDIN));\necho "got $n\\n";\n', (s) => s === "Q:\n-2\ngot -2\n"],
  ["main.pl", 'print "Q:\\n";\nmy $n = <STDIN>;\nchomp $n;\nprint "got $n\\n";\n', (s) => s === "Q:\n-2\ngot -2\n"],
  ["main.bas", '10 PRINT "Q:"\n20 INPUT N\n30 PRINT "GOT"; N\n', (s) => s.indexOf("-2") > s.indexOf("Q:") && s.indexOf("-2") < s.indexOf("GOT")],
];
for (const [filename, code, ok] of placed) {
  const r = await run(filename, code, ["-2", "Ada"]);
  check(`typed answers where they're read: ${filename}`, r && ok(r.screen), JSON.stringify(r?.screen));
}
const rb = await run("main.rb", 'puts "Q:"\nn = gets.chomp\nputs "got #{n}"\n', ["-2"]);
check("Ruby: typed answers not shown, and the result says so", rb && !rb.screen.startsWith("-2") && /typed answers/i.test(rb.outcome ?? ""), JSON.stringify(rb));

// Out of answers: the program reads end-of-input right away instead of the
// check waiting out its time limit.
const eof = await run("main.py", 'a = input("A? ")\nb = input("B? ")\nprint(a, b)\n', ["1"]);
check("answers run out → ends promptly", eof && eof.ms < 9000 && /EOF/i.test(eof.error ?? ""), JSON.stringify(eof));
check("C has no private check (would start the compiler download)", tutorTools({ filename: "main.c", code: "int main(void){return 0;}" }).tools === undefined);

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
