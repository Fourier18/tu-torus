// The Ruby reference for what the learner's code uses, attached to each
// tutor message about a .rb file. Mirrors python-reference.js; entries
// come from server/knowledge/ruby-3.4/reference.json (hand-authored).
// Covers the constructs a beginner's Ruby program most commonly uses, with
// special attention to documented failure modes: puts blank-line myth,
// elsif vs elif, gets needing chomp, integer vs float division.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REF_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "knowledge", "ruby-3.4", "reference.json");
let reference = null;
const entries = () => (reference ??= JSON.parse(readFileSync(REF_PATH, "utf8"))).entries;

export const REFERENCE_BUDGET = 8_000;

// Maps Ruby keywords and common method names to reference keys.
// Methods appear as bare identifiers in code (puts, gets, chomp, each…)
// so the IDENT scan picks them up alongside keywords.
const KEYWORDS = {
  if: "if", elsif: "if", else: null,
  unless: "unless",
  while: "while", until: "until",
  for: "for",
  def: "def", return: "def",
  class: "class",
  nil: "nil",
  puts: "puts", print: "print", p: "p",
  gets: "gets", chomp: "chomp",
  to_i: "to_i", to_f: "to_f", to_s: "to_s",
  each: "each", times: "times",
  push: "push", pop: "pop",
  length: "length", size: "length",
  upcase: "upcase", downcase: "downcase",
};

// true/false appear in every program; their entries aren't worth attaching
// unless the learner specifically asks about them.
const ONLY_WHEN_ASKED = new Set(["true", "false"]);

// Ruby method names that are not English words: counted as code references
// in a question even without backtick/paren formatting.
const ALWAYS_CODE = new Set(["puts", "gets", "chomp", "to_i", "to_f", "to_s", "each", "times", "push", "pop", "upcase", "downcase", "elsif", "nil"]);

// Ruby strings and comments removed so "puts" inside a string literal
// ("sorry, no puts here") doesn't trigger a reference lookup.
// Ruby heredocs (<<~HEREDOC…HEREDOC) are not stripped — rare in beginner code.
function codeOnly(code) {
  return code
    .replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, '""')
    .replace(/#.*$/gm, "");
}

// Ruby identifiers may end with ? or ! (e.g. empty?, chomp!, upcase?).
// We match the full token but key only the base form without ? or !.
const IDENT = /[A-Za-z_][A-Za-z0-9_]*[?!]?/g;

function keyFor(word) {
  const base = word.replace(/[?!]$/, "");
  if (Object.hasOwn(KEYWORDS, base)) return KEYWORDS[base];
  return Object.hasOwn(entries(), word) ? word : Object.hasOwn(entries(), base) ? base : null;
}

function codeKeys(code) {
  const keys = [];
  const add = (k) => { if (k && !ONLY_WHEN_ASKED.has(k) && !keys.includes(k)) keys.push(k); };
  for (const [word] of codeOnly(code).matchAll(IDENT)) add(keyFor(word));
  return keys;
}

// Question keys: only count a word if the code already uses it, or if it
// is written in a code-like way (`word`, word(), "word"), or if it contains
// uppercase or underscores (non-English-word signal).
function questionKeys(question, inCode) {
  const keys = [];
  for (const [word] of String(question ?? "").matchAll(IDENT)) {
    const key = keyFor(word);
    if (!key || keys.includes(key)) continue;
    const asCode = new RegExp(`\`${word.replace(/[?!]/g, "\\$&")}\\b|\\b${word.replace(/[?!]/g, "\\$&")}[(?!]|["']${word.replace(/[?!]/g, "\\$&")}["']`).test(question);
    const notEnglish = /[A-Z0-9_]/.test(word) && !Object.hasOwn(KEYWORDS, word.replace(/[?!]$/, ""));
    if (inCode.includes(key) || asCode || notEnglish || ALWAYS_CODE.has(word.replace(/[?!]$/, ""))) keys.push(key);
  }
  return keys;
}

// Error class names (NoMethodError, TypeError, …) in error output.
function errorKeys(errorText) {
  const keys = [];
  for (const [, name] of String(errorText ?? "").matchAll(/\b([A-Z][A-Za-z]*(?:Error|Exception|Warning|Interrupt))\b/g)) {
    if (Object.hasOwn(entries(), name) && !keys.includes(name)) keys.push(name);
  }
  return keys;
}

export function rubyReferenceFor({ code, question, errorText, budget = REFERENCE_BUDGET }) {
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
    "The Ruby documentation (3.4) for what this code uses. It is the authority on what Ruby does: where your memory disagrees, go by this.",
    ...picked.map((e) => `[${e.where}]\n${e.text}`),
  ].join("\n\n");
}
