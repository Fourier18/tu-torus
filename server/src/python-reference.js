// The official Python documentation for what the learner's code uses,
// attached to each tutor message about a .py file (buildUserContent). From
// memory alone the tutor got documented facts wrong in the user's own
// sessions: it taught "two print() calls in a row = one blank line"
// (2026-10-08), where the documentation says print() with nothing in it
// writes just *end*, a newline. Excerpts come from knowledge/python-3.14/
// reference.json (scripts/build-python-reference.mjs).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REF_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "knowledge", "python-3.14", "reference.json");
let reference = null;
const entries = () => (reference ??= JSON.parse(readFileSync(REF_PATH, "utf8"))).entries;

// Characters of documentation per message: room for every entry a beginner
// file uses (the is_even program takes about 8,000), without crowding out
// the code and the run.
export const REFERENCE_BUDGET = 12_000;

const KEYWORDS = {
  if: "if", elif: "if", while: "while", for: "for", try: "try", except: "try", finally: "try",
  with: "with", def: "def", class: "class", return: "return", break: "break", continue: "continue",
  pass: "pass", import: "import", from: "import", raise: "raise", assert: "assert", del: "del",
  global: "global", nonlocal: "nonlocal",
};
// Looked up only when asked about: in nearly every program, and their
// entries say little a beginner needs.
const ONLY_WHEN_ASKED = new Set(["True", "False", "None"]);

// Code without comments or string contents, so the words in
// print("Sorry, please input only natural numbers!") don't count as uses.
function codeOnly(code) {
  return code
    .replace(/("""|''')[\s\S]*?\1/g, '""')
    .replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, '""')
    .replace(/#.*$/gm, "");
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g;
function keyFor(word) {
  if (KEYWORDS[word]) return KEYWORDS[word];
  return Object.hasOwn(entries(), word) ? word : null;
}

// What the code uses, in order of first appearance.
function codeKeys(code) {
  const keys = [];
  const add = (k) => { if (k && !ONLY_WHEN_ASKED.has(k) && !keys.includes(k)) keys.push(k); };
  const plain = codeOnly(code);
  for (const line of plain.split("\n")) {
    if (/^\s*match\s+\S.*:\s*$/.test(line)) add("match"); // a soft keyword: only as a statement
    for (const [word] of line.matchAll(IDENT)) if (word !== "match") add(keyFor(word));
  }
  return keys;
}

// What the question asks about. Words that are also English ("for", "try",
// "print", "help") count only when the code uses them, or when written as
// code: `print`, print(), "print".
function questionKeys(question, inCode) {
  const keys = [];
  for (const [word] of String(question ?? "").matchAll(IDENT)) {
    const key = keyFor(word);
    if (!key || keys.includes(key)) continue;
    const asCode = new RegExp(`\`${word}\\b|\\b${word}\\(|["']${word}["']`).test(question);
    const notEnglish = /[A-Z0-9_]/.test(word) && !KEYWORDS[word];
    if (inCode.includes(key) || asCode || notEnglish) keys.push(key);
  }
  return keys;
}

// What the error names: the exception, and built-ins it mentions ("invalid
// literal for int() with base 10").
function errorKeys(errorText) {
  const keys = [];
  const text = String(errorText ?? "");
  for (const [, name] of text.matchAll(/\b([A-Z][A-Za-z]*(?:Error|Exception|Warning|Interrupt|Exit))\b/g)) if (Object.hasOwn(entries(), name) && !keys.includes(name)) keys.push(name);
  for (const [, name] of text.matchAll(/\b([a-z_][a-z0-9_]*)\(\)/g)) if (Object.hasOwn(entries(), name) && !keys.includes(name)) keys.push(name);
  return keys;
}

// The documentation block for one tutor message, or "" when there's nothing
// to attach. Asked-about and error-related entries get every excerpt (the
// Tutorial's explanation and the Reference's); the rest of the code gets one
// each, then second excerpts while the budget lasts.
export function pythonReferenceFor({ code, question, errorText, budget = REFERENCE_BUDGET }) {
  if (code == null) return "";
  const inCode = codeKeys(code);
  const urgent = [...new Set([...questionKeys(question, inCode), ...errorKeys(errorText)])];
  const rest = inCode.filter((k) => !urgent.includes(k));
  const all = entries();
  const picked = [];
  let used = 0;
  const take = (excerpt) => {
    if (picked.includes(excerpt) || used + excerpt.text.length > budget) return;
    picked.push(excerpt);
    used += excerpt.text.length;
  };
  for (const k of urgent) for (const e of all[k] ?? []) take(e);
  for (const k of rest) if (all[k]?.[0]) take(all[k][0]);
  for (const k of rest) for (const e of (all[k] ?? []).slice(1)) take(e);
  if (!picked.length) return "";
  return [
    "The official Python documentation (3.14, the version this app runs) for what this code uses, quoted exactly. It is the authority on what Python does: where your memory disagrees, go by this.",
    ...picked.map((e) => `[${e.where}]\n${e.text}`),
  ].join("\n\n");
}
