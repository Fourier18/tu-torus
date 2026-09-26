// End-to-end checks for the built-in languages, through the same runOnce()
// the app's Run button uses: each program prompts, gets a typed line after a
// delay (like a person typing), and must print the expected result.
// Run: node server/test/languages.test.mjs [--slow]
//   --slow adds a 17-second pause before typing (the run limit is 15s, and
//   waiting at a prompt must not count) and a runaway loop that must be stopped.
import { runOnce } from "../src/runner.js";

const CASES = [
  { ext: "py", code: 'a = int(input("Age? "))\nprint("Next year:", a + 1)\n', input: "41", expect: /Next year: 42/ },
  { ext: "js", code: 'const readline = require("node:readline/promises");\nconst rl = readline.createInterface({ input: process.stdin, output: process.stdout });\nrl.question("Age? ").then((a) => { console.log(`Next year: ${Number(a) + 1}`); rl.close(); });\n', input: "41", expect: /Next year: 42/ },
  { ext: "bas", code: '10 INPUT "Age"; A\n20 PRINT "Next year:"; A + 1\n', input: "41", expect: /Next year: 42/ },
  { ext: "lua", code: 'io.write("Age? ")\nlocal a = io.read("n")\nprint("Next year: " .. (a + 1))\n', input: "41", expect: /Next year: 42/ },
  { ext: "rb", code: 'print "Age? "\na = gets.to_i\nputs "Next year: #{a + 1}"\n', input: "41", expect: /Next year: 42/ },
  { ext: "php", code: '<?php\n$a = (int) readline("Age? ");\necho "Next year: ", $a + 1, "\\n";\n', input: "41", expect: /Next year: 42/ },
  { ext: "pl", code: 'print "Age? ";\nmy $a = <STDIN>;\nprint "Next year: ", $a + 1, "\\n";\n', input: "41", expect: /Next year: 42/ },
  { ext: "ts", code: 'import * as readline from "node:readline/promises";\nconst rl = readline.createInterface({ input: process.stdin, output: process.stdout });\nconst a: number = Number(await rl.question("Age? "));\nconsole.log(`Next year: ${a + 1}`);\nrl.close();\n', input: "41", expect: /Next year: 42/ },
  // C/C++: the first run downloads the compiler into the data folder's tools/
  { ext: "c", code: '#include <stdio.h>\nint main(void) { int a; printf("Age? "); fflush(stdout); scanf("%d", &a); printf("Next year: %d\\n", a + 1); return 0; }\n', input: "41", expect: /Next year: 42/ },
  { ext: "cpp", code: '#include <iostream>\n#include <vector>\nint main() { int a; std::cout << "Age? " << std::flush; std::cin >> a; std::vector<int> v{a}; std::cout << "Next year: " << v[0] + 1 << std::endl; }\n', input: "41", expect: /Next year: 42/ },
  { ext: "c", code: "int main(void) { int x = ; }\n", expectError: /main\.c:1:26: error: expected expression/ },
  { ext: "c", code: "int main(void) { int z = 0; return 5 / z; }\n", expectError: /The program crashed/ },
  // errors come back as plain messages that name the line
  { ext: "ts", code: 'const x: number = "text";\n', expectError: /line 1.*not assignable to type 'number'/ },
  { ext: "rb", code: 'x = nil\nputs x.upcase\n', expectError: /main\.rb:2: undefined method 'upcase'/ },
  { ext: "lua", code: 'local t = nil\nprint(t.x)\n', expectError: /line:2: attempt to index a nil value/ },
  { ext: "php", code: '<?php\necho 1 +;\n', expectError: /syntax error.*line 2/ },
  { ext: "pl", code: 'use strict;\nprint $y;\n', expectError: /main\.pl line 2/ },
  { ext: "bas", code: 'PRINT "oops\n', expectError: /line 1/ },
];

const slow = process.argv.includes("--slow");
if (slow) {
  CASES.push({ ext: "bas", code: '10 INPUT "Age"; A\n20 PRINT "Next year:"; A + 1\n', input: "41", delay: 17000, expect: /Next year: 42/, label: "17s at a prompt" });
  CASES.push({ ext: "lua", code: "while true do end\n", expectError: /Timed out/, label: "runaway loop" });
}

function run({ ext, code, input, delay = 800 }) {
  return new Promise((resolve) => {
    let out = "";
    const t0 = Date.now();
    runOnce({ file: `main.${ext}`, ext, code, onData: (d) => { out += d.text; }, onExit: (e) => resolve({ out, e, ms: Date.now() - t0 }) })
      .then((session) => { if (input != null) setTimeout(() => session.write(input), delay); });
  });
}

let failed = 0;
for (const c of CASES) {
  const { out, e, ms } = await run(c);
  const ok = c.expectError ? !e.ok && c.expectError.test(`${e.error ?? ""}\n${out}`) : e.ok && c.expect.test(out);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  .${c.ext}  ${c.label ?? (c.expectError ? "error message" : "prompt + typed input")}  (${ms} ms)`);
  if (!ok) console.log("   output:", JSON.stringify(out), "\n   exit:", JSON.stringify(e));
}
console.log(failed ? `${failed} failed` : "all passed");
process.exitCode = failed ? 1 : 0;
