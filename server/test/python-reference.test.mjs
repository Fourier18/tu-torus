// The Python documentation attached to tutor messages (python-reference.js,
// knowledge/python-3.14/reference.json). The program is the user's own
// is_even from the 2026-10-08 session, where the tutor got print() and
// blank lines wrong from memory.
//
// usage: node server/test/python-reference.test.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pythonReferenceFor, REFERENCE_BUDGET } from "../src/python-reference.js";
import { buildUserContent, pythonCrashLine } from "../src/tutor.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const { entries, notice } = JSON.parse(readFileSync(path.join(dir, "..", "knowledge", "python-3.14", "reference.json"), "utf8"));

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${JSON.stringify(detail)}`}`); if (!ok) failed++; };
const flat = (s) => s.replace(/\s+/g, " ");
const where = (block) => [...block.matchAll(/^\[(.+)\]$/gm)].map((m) => m[1]);

// The reference itself.
check("carries the PSF notice", /Copyright © 2001 Python Software Foundation/.test(notice), notice);
for (const k of ["print", "input", "int", "while", "try", "break", "def", "if", "ValueError", "range", "len"]) check(`has an entry for ${k}`, Array.isArray(entries[k]) && entries[k].length > 0, k);
check("print(): the documented fact the tutor got wrong", entries.print.some((e) => flat(e.text).includes('If no *objects* are given, "print()" will just write *end*.')), entries.print);
check("try: the Tutorial's step-by-step, with the retry loop", entries.try.some((e) => flat(e.text).includes("execution continues after the try/except block") && e.text.includes("while True:")), entries.try.map((e) => e.where));
check("version notes are left out", !Object.values(entries).flat().some((e) => /^\s*Changed in version/m.test(e.text)), "");

const isEven = `# practice py f(x)

def is_even():
    print("Give me a natural number:")
    print()
    while True:
        try:
            num = int(input())
            break
        except ValueError:
            print()
            print("Sorry, please input only natural numbers!")
            print()
    while num <= 0:
        print()
        print("Sorry, please input only natural numbers!")
        print()
        num = int(input())

    print()

    while True:
        if num % 2 == 0:
            print("It's even!")
        else:
            print("It's odd!")
        break

is_even()
`;

// What the code uses.
let block = pythonReferenceFor({ code: isEven });
let got = where(block);
for (const w of ["Built-in Functions: print()", "Built-in Functions: input()", "Built-in Functions: int()", "Built-in Exceptions: ValueError"]) check(`is_even: attaches ${w}`, got.some((g) => g.includes(w)), got);
for (const k of ["while", "Handling Exceptions", "break", "Defining Functions", '"if" Statements']) check(`is_even: attaches something on ${k}`, got.some((g) => g.includes(k)), got);
check("is_even: nothing it doesn't use (range)", !got.some((g) => /range/.test(g)), got);
const excerptChars = (b) => b.split(/\n\n(?=\[)/).slice(1).reduce((n, part) => n + part.replace(/^\[.+\]\n/, "").length, 0);
check(`is_even: within the budget (${REFERENCE_BUDGET})`, excerptChars(block) <= REFERENCE_BUDGET, excerptChars(block));

// Words in strings and comments aren't uses.
got = where(pythonReferenceFor({ code: 'print("try again later, for real")\n# while you wait\n' }));
check("words in strings and comments don't count", got.length === 1 && got[0].includes("print()"), got);

// The question comes first.
block = pythonReferenceFor({ code: isEven, question: "why is there no gap after the Sorry line?? is it print()" });
check("asked about print(): print's entry comes first", where(block)[0]?.includes("print()"), where(block));
got = where(pythonReferenceFor({ code: "x = 1", question: "what does `range` do?" }));
check("asked about `range` in code style: attached though unused", got.some((g) => g.includes("range")), got);
got = where(pythonReferenceFor({ code: "x = 1", question: "can you help me with this for my class" }));
check("English words aren't lookups (help, for, class)", got.length === 0, got);

// The error comes next.
block = pythonReferenceFor({ code: isEven, errorText: "Traceback (most recent call last):\n  File \"<exec>\", line 18, in is_even\nValueError: invalid literal for int() with base 10: '-7j'" });
got = where(block);
check("error: ValueError and int() lead", got[0]?.includes("ValueError") && got[1]?.includes("int()"), got.slice(0, 3));

// The budget holds.
check("a small budget is kept", excerptChars(pythonReferenceFor({ code: isEven, budget: 1000 })) <= 1000, "");

// Where a run stopped: the line, quoted, and the blocks around it. The
// traceback is the learner Run's, after tutor.js drops Pyodide's frames.
const crash7j = "Traceback (most recent call last):\n  File \"<exec>\", line 30, in <module>\n  File \"<exec>\", line 18, in is_even\nValueError: invalid literal for int() with base 10: '-7j'";
const where7j = pythonCrashLine(crash7j, isEven);
check("crash line: the -7j crash is line 18, the second int(input())", /line 18 of their file, `num = int\(input\(\)\)`/.test(where7j), where7j);
check("crash line: names the loop it's in, and no try", /inside `while num <= 0:` \(line 14\), inside `def is_even\(\):` \(line 3\)/.test(where7j) && !/try/.test(where7j), where7j);
check("crash line: ends with the error message", where7j.endsWith("ValueError: invalid literal for int() with base 10: '-7j'"), where7j);
const inTry = pythonCrashLine("Traceback (most recent call last):\n  File \"<exec>\", line 8, in is_even\nValueError: x", isEven);
check("crash line: a line inside try names the try", /inside `try:` \(line 7\), inside `while True:` \(line 6\)/.test(inTry), inTry);
check("crash line: nothing without a traceback line", pythonCrashLine("SomethingError: no frames", isEven) === "", "");

// Only for Python files, through the real message builder.
check("buildUserContent: .py gets the documentation", buildUserContent({ trigger: "check", filename: "main.py", code: isEven }).includes("The official Python documentation"), "");
check("buildUserContent: .js doesn't", !buildUserContent({ trigger: "check", filename: "main.js", code: "console.log(1)" }).includes("The official Python documentation"), "");

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
