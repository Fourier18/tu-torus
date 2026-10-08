// Builds server/knowledge/python-3.14/reference.json: excerpts of the
// official Python 3.14 documentation, one entry per built-in function,
// built-in exception, constant and statement, plus the Tutorial sections
// that explain the statements to beginners. The tutor gets the entries for
// what the learner's code uses (python-reference.js), so what it says about
// Python comes from the documentation, not from the model's memory.
//
// Wording is the documentation's own. Left out: version-history notes,
// auditing-event notes, implementation details, grammar rules and footnote
// markers; long entries are cut at a paragraph boundary. The PSF License
// asks for this summary of changes; sources.json carries it as well.
//
// Input: the plain-text docs archive from
// https://docs.python.org/3.14/archives/python-3.14-docs-text.zip, unpacked
// (it isn't committed; both paths are gitignored).
// usage: node scripts/build-python-reference.mjs [path to the unpacked folder]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const docs = path.resolve(process.argv[2] ?? path.join(root, "python-3.14-docs-text", "python-3.14-docs-text"));
if (!existsSync(path.join(docs, "builtins", "functions.txt"))) {
  console.error(`No Python 3.14 text docs at ${docs}. Download https://docs.python.org/3.14/archives/python-3.14-docs-text.zip, unpack it, and pass the folder that contains builtins/, reference/ and tutorial/.`);
  process.exit(1);
}
const read = (f) => readFileSync(path.join(docs, f), "utf8").replace(/\r\n/g, "\n");

const REFERENCE_CAP = 1600; // characters per excerpt, cut at a paragraph boundary
const TUTORIAL_CAP = 1800;

// ---- cleaning -------------------------------------------------------------
const DROP = /^\s*(Changed in version|Added in version|Deprecated since version|Raises an auditing event|CPython implementation detail|Availability:|See also:)/;
const GRAMMAR = /^\s+[a-z_][a-z0-9_]*:\s+\S/; // "   while_stmt: "while" assignment_expression ":" suite"
function clean(text, cap, where) {
  const paragraphs = text.replace(/ \[\d+\]/g, "").split(/\n\s*\n/).map((p) => p.replace(/\s+$/, "")).filter((p) => p.trim() && !DROP.test(p) && !GRAMMAR.test(p));
  const kept = [];
  let size = 0;
  for (const p of paragraphs) {
    if (kept.length && size + p.length + 2 > cap) { kept.push(`(… continues in the Python documentation: ${where})`); break; }
    kept.push(p);
    size += p.length + 2;
  }
  return kept.join("\n\n");
}

// ---- entries in builtins/*.txt: a header line at column 0, then a body
// indented by 3 spaces, until the next line at column 0 ----------------------
function entries(file, headerRe) {
  const lines = read(file).split("\n");
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headerRe);
    if (!m) continue;
    const head = [lines[i]];
    while (i + 1 < lines.length && headerRe.test(lines[i + 1]) && lines[i + 1].match(headerRe)[1] === m[1]) head.push(lines[++i]); // overloads
    const body = [];
    let j = i + 1;
    for (; j < lines.length && (lines[j] === "" || /^\s/.test(lines[j])); j++) body.push(lines[j].replace(/^ {3}/, ""));
    found.push({ name: m[1], text: `${head.join("\n")}\n\n${body.join("\n").trim()}` });
    i = j - 1;
  }
  return found;
}

// ---- sections in reference/ and tutorial/: a numbered title underlined
// with = - ~ ^ or *; a section runs until the next title of the same or a
// higher level, so its subsections come with it -----------------------------
function sections(file) {
  const lines = read(file).split("\n");
  const heads = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!/^([=\-~^*"])\1{3,}$/.test(lines[i + 1]) || !lines[i].trim()) continue;
    const m = lines[i].match(/^(\d+(?:\.\d+)*)\.\s+(.*)$/);
    if (m) heads.push({ line: i, number: m[1], title: m[2], level: m[1].split(".").length });
  }
  return heads.map((h, k) => {
    const end = heads.slice(k + 1).find((n) => n.level <= h.level)?.line ?? lines.length;
    return { ...h, text: lines.slice(h.line + 2, end).join("\n").trim() };
  });
}

const out = {};
const add = (key, excerpt) => { (out[key] ??= []).push(excerpt); };

// Built-in functions and classes: "print(*objects, ...)", "class int(...)".
for (const e of entries("builtins/functions.txt", /^(?:class )?([A-Za-z_][A-Za-z0-9_]*)\(/)) {
  add(e.name, { where: `Library Reference, Built-in Functions: ${e.name}()`, text: clean(e.text, REFERENCE_CAP, `Built-in Functions, ${e.name}()`) });
}
// Built-in exceptions: "exception ValueError".
for (const e of entries("builtins/exceptions.txt", /^exception ([A-Za-z_][A-Za-z0-9_]*)/)) {
  add(e.name, { where: `Library Reference, Built-in Exceptions: ${e.name}`, text: clean(e.text, REFERENCE_CAP, `Built-in Exceptions, ${e.name}`) });
}
// Constants: True, False, None.
for (const e of entries("builtins/constants.txt", /^(True|False|None)$/)) {
  add(e.name, { where: `Library Reference, Built-in Constants: ${e.name}`, text: clean(e.text, REFERENCE_CAP, `Built-in Constants, ${e.name}`) });
}

// Statements. Beginner-facing Tutorial sections first, then the Language
// Reference, so a short budget keeps the plainer explanation.
const TUTORIAL = {
  "tutorial/errors.txt": { "Handling Exceptions": ["try"], "Syntax Errors": ["SyntaxError"] },
  "tutorial/controlflow.txt": {
    '"if" Statements': ["if"], '"for" Statements': ["for"], 'The "range()" Function': ["range"],
    '"break" and "continue" Statements': ["break", "continue"], '"pass" Statements': ["pass"],
    '"match" Statements': ["match"], "Defining Functions": ["def", "return"],
  },
  "tutorial/introduction.txt": { "First Steps Towards Programming": ["while"] },
};
const REFERENCE = {
  "reference/compound_stmts.txt": {
    'The "if" statement': ["if"], 'The "while" statement': ["while"], 'The "for" statement': ["for"],
    'The "try" statement': ["try"], 'The "with" statement': ["with"], 'The "match" statement': ["match"],
    "Function definitions": ["def"], "Class definitions": ["class"],
  },
  "reference/simple_stmts.txt": {
    "Assignment statements": ["="], 'The "assert" statement': ["assert"], 'The "pass" statement': ["pass"],
    'The "del" statement': ["del"], 'The "return" statement': ["return"], 'The "raise" statement': ["raise"],
    'The "break" statement': ["break"], 'The "continue" statement': ["continue"], 'The "import" statement': ["import"],
    'The "global" statement': ["global"], 'The "nonlocal" statement': ["nonlocal"],
  },
};
const missing = [];
for (const [where, table] of [["Tutorial", TUTORIAL], ["Language Reference", REFERENCE]]) {
  for (const [file, titles] of Object.entries(table)) {
    const found = sections(file);
    for (const [title, keys] of Object.entries(titles)) {
      const s = found.find((x) => x.title === title);
      if (!s) { missing.push(`${file}: ${title}`); continue; }
      const label = `${where} ${s.number}, ${title}`;
      for (const key of keys) add(key, { where: label, text: clean(s.text, where === "Tutorial" ? TUTORIAL_CAP : REFERENCE_CAP, label) });
    }
  }
}
if (missing.length) { console.error(`Sections not found (did the docs change?):\n  ${missing.join("\n  ")}`); process.exit(1); }

const target = path.join(root, "server", "knowledge", "python-3.14");
mkdirSync(target, { recursive: true });
const result = {
  about: "Excerpts of the official Python 3.14 documentation, keyed by built-in name, exception, constant or statement keyword. Built by scripts/build-python-reference.mjs; see server/knowledge/sources.json (python-docs-3.14).",
  notice: "Python documentation: Copyright © 2001 Python Software Foundation; All Rights Reserved. Used under the PSF License Agreement Version 2. Changes: excerpted per entry; wording unchanged; version-history notes, auditing-event notes, implementation details, grammar rules and footnote markers left out; long entries cut at a paragraph boundary.",
  python: "3.14",
  built_from: "python-3.14-docs-text.zip from https://docs.python.org/3.14/archives/ (archive last modified 2026-09-28)",
  entries: Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))),
};
writeFileSync(path.join(target, "reference.json"), JSON.stringify(result, null, 1) + "\n");
const count = Object.keys(out).length;
const chars = Object.values(out).flat().reduce((n, e) => n + e.text.length, 0);
console.log(`reference.json: ${count} keys, ${Object.values(out).flat().length} excerpts, ${(chars / 1024).toFixed(0)} KB of text`);
