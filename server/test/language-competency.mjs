// Language competency: can the tutor write correct, runnable examples in
// every language the app offers — programs, and data/markup formats (JSON,
// Markdown, HTML, CSS)? A learner asks for a small example; the first code
// block in the reply is taken out and checked for real:
//   - programs: run through the app's own runtime (runOnce), output matched
//   - JSON: JSON.parse, then the shape asked for
//   - HTML / CSS / Markdown: structural checks (tags balanced, rules parse,
//     the Markdown elements asked for are present)
// Data types are covered on purpose (integer vs. float division, lists,
// dictionaries/hashes, strings vs. numbers, booleans), since that's where a
// tutor's examples most often go quietly wrong between languages.
//
// usage: node server/test/language-competency.mjs [label] [ext,ext,...]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chat } from "../src/providers/openai-compatible.js";
import { buildUserContent, buildSystemPrompt } from "../src/tutor.js";
import { runOnce } from "../src/runner.js";
import { LANGUAGES } from "../src/languages.js";
import { loadProvider } from "./test-provider.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const provider = await loadProvider(); // test-provider.mjs (TUTOR_API_KEY when the app's key is encrypted)
const model = process.env.MODEL || provider.model;
const instructions = await readFile(path.join(__dirname, "..", "src", "tutor-instructions.md"), "utf-8");
const label = process.argv[2] || "run";
const only = process.argv[3]?.split(",");

// Program tasks shared by every programming language; `expect` is checked
// against what the program prints (case-insensitive, whitespace-tolerant).
const PROGRAM_TASKS = [
  { id: "hello", ask: "show me the shortest program that prints Hello, world!", expect: [/hello,? world/i] },
  { id: "loop", ask: "show me a loop that prints the numbers 1 to 5, one per line, and nothing else", expect: [/^\s*1\s*\n\s*2\s*\n\s*3\s*\n\s*4\s*\n\s*5\s*$/] },
  { id: "division", ask: "show me a program that prints 7 divided by 2 as a decimal (3.5) and then the whole-number result of 7 divided by 2 (3), each on its own line, and nothing else", expect: [/3\.5/, /(^|\n)\s*3\s*(\n|$)/] },
  { id: "list", ask: "show me how to make a list (or array) of three fruit names — apple, banana, cherry — and print how many items it has, then the second item. Print only those two lines", expect: [/(^|\n)\s*3\s*(\n|$)/, /banana/i] },
  { id: "dict", ask: "show me a dictionary / hash / map (whatever this language calls it) with name set to Ada and age set to 36, then print the name and the age on separate lines and nothing else", expect: [/ada/i, /36/] },
  { id: "strnum", ask: "show me how to turn the text \"41\" into a number, add 1 to it, and print the result (42) and nothing else", expect: [/(^|\n)\s*42(\.0+)?\s*(\n|$)/] },
  { id: "bool", ask: "show me a program that checks whether 10 is greater than 3 and prints yes if it is, no if it isn't — just the word", expect: [/(^|\n)\s*yes\s*(\n|$)/i] },
  { id: "function", ask: "show me a function that takes two numbers and returns their sum, then print the result of calling it with 2 and 3 (5) and nothing else", expect: [/(^|\n)\s*5(\.0+)?\s*(\n|$)/] },
  { id: "input", ask: "show me a program that asks for a name, reads what's typed, and prints Hi followed by the name", inputs: ["Ada"], expect: [/hi,? ada/i] },
];

// BASIC (QBasic-style) has no dictionaries and functions differ; keep its
// tasks to what the language has.
const BASIC_SKIP = new Set(["dict"]);
// C has no built-in dictionary type either.
const C_SKIP = new Set(["dict"]);

const DATA_TASKS = {
  json: [
    { id: "object", ask: "show me a JSON object for a person with a name (text), an age (number), a list of hobbies, and whether they're a student (true/false)", check: (t) => { const o = JSON.parse(t); return typeof o.name === "string" && typeof o.age === "number" && Array.isArray(o.hobbies) && typeof (o.student ?? o.isStudent ?? o.is_student) === "boolean"; } },
    { id: "array", ask: "show me a JSON array of three books, each with a title and a year", check: (t) => { const a = JSON.parse(t); const arr = Array.isArray(a) ? a : Object.values(a).find(Array.isArray); return arr?.length === 3 && arr.every((b) => typeof b.title === "string" && typeof b.year === "number"); } },
    { id: "nested", ask: "show me JSON with a nested object: a company with a name and an address object that has street and city, and a null phone number", check: (t) => { const o = JSON.parse(t); const c = o.company ?? o; return typeof c.address === "object" && c.address.city && JSON.stringify(o).includes("null"); } },
  ],
  md: [
    { id: "basics", ask: "show me a short markdown document with a top heading, a bulleted list of three items, a bold word and a link", check: (t) => /^#\s+\S/m.test(t) && (t.match(/^\s*[-*+]\s+\S/gm) ?? []).length >= 3 && /\*\*[^*]+\*\*|__[^_]+__/.test(t) && /\[[^\]]+\]\([^)]+\)/.test(t) },
    { id: "table", ask: "show me a markdown table with two columns, Name and Age, and two rows", check: (t) => /\|\s*Name\s*\|\s*Age\s*\|/i.test(t) && /^\s*\|?\s*:?-{3,}:?\s*\|\s*:?-{3,}:?\s*\|?\s*$/m.test(t) && (t.match(/^\s*\|.*\|\s*$/gm) ?? []).length >= 4 },
    { id: "code", ask: "show me how to put a Python code snippet inside a markdown document so it shows as code", fence: "any", check: (t) => /(^|\n)(```|~~~)\s*python/i.test(t) || /(^|\n)( {4}|\t)\S/.test(t) },
  ],
  html: [
    { id: "page", ask: "show me a complete small HTML page with a title, a heading, a paragraph and a link", check: (t) => balanced(t) && /<title>[^<]+<\/title>/i.test(t) && /<h1[\s>]/i.test(t) && /<p[\s>]/i.test(t) && /<a\s[^>]*href=/i.test(t) },
    { id: "list", ask: "show me HTML for an unordered list of three colors", check: (t) => balanced(t) && /<ul[\s>]/i.test(t) && (t.match(/<li[\s>]/gi) ?? []).length === 3 },
    { id: "form", ask: "show me an HTML form with a text box labelled Name and a submit button", check: (t) => balanced(t) && /<form[\s>]/i.test(t) && /<input[^>]*(type=["']?text|(?![^>]*type=))/i.test(t) && /<label[\s>]/i.test(t) && /(type=["']?submit|<button)/i.test(t) },
  ],
  css: [
    { id: "rule", ask: "show me CSS that makes every paragraph blue with 18px text", check: (t) => cssParses(t) && /\bp\s*\{[^}]*color\s*:\s*blue[^}]*\}/i.test(t) && /font-size\s*:\s*18px/i.test(t) },
    { id: "class", ask: "show me CSS for a class called card with a 1px solid gray border, 8px rounded corners and 16px of padding", check: (t) => cssParses(t) && /\.card\s*\{/.test(t) && /border\s*:\s*1px\s+solid\s+(gray|grey|#[0-9a-f]{3,6})/i.test(t) && /border-radius\s*:\s*8px/i.test(t) && /padding\s*:\s*16px/i.test(t) },
    { id: "flex", ask: "show me CSS that centers a div with the class box horizontally and vertically inside its parent using flexbox", check: (t) => cssParses(t) && /display\s*:\s*flex/i.test(t) && /justify-content\s*:\s*center/i.test(t) && /align-items\s*:\s*center/i.test(t) },
  ],
};

// Tags that don't close. Anything else opened must close, in order.
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr", "!doctype"]);
function balanced(html) {
  const stack = [];
  for (const m of html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<\/?([a-z!][a-z0-9]*)[^>]*?(\/?)>/gi)) {
    const tag = m[1].toLowerCase();
    if (VOID.has(tag) || m[2] === "/") continue;
    if (m[0].startsWith("</")) { if (stack.pop() !== tag) return false; } else stack.push(tag);
  }
  return stack.length === 0;
}
function cssParses(css) {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  for (const ch of body) { if (ch === "{") depth++; if (ch === "}" && --depth < 0) return false; }
  if (depth !== 0) return false;
  // every declaration inside a block is "prop: value"
  return [...body.matchAll(/\{([^{}]*)\}/g)].every((b) => b[1].split(";").map((d) => d.trim()).filter(Boolean).every((d) => /^[-a-z]+\s*:\s*\S/i.test(d)));
}

function firstCode(reply, fence) {
  const blocks = [...reply.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (fence === "any") return blocks.length ? reply : reply; // the whole reply is the markdown answer
  return blocks.sort((a, b) => b.length - a.length)[0] ?? null;
}

function runIt(ext, code, inputs = []) {
  return new Promise((resolve) => {
    let out = "";
    let session;
    const t = setTimeout(() => { session?.kill(); resolve({ ok: false, output: out, error: "timeout" }); }, 90000);
    runOnce({ file: `main.${ext}`, ext, code, onData: (d) => { if (d.stream === "stdout") out += d.text; }, onExit: (e) => { clearTimeout(t); resolve({ ok: e.ok, output: out, error: e.error ?? "" }); } })
      .then((s) => { session = s; for (const i of inputs) s.write(i); });
  });
}

async function complete(systemPrompt, userContent) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let text = "";
    let notice = false;
    for await (const e of chat({ systemPrompt, history: [], userContent, baseUrl: provider.baseUrl, apiKey: provider.apiKey, model, providerLabel: provider.preset })) { if (e.type === "text") text += e.text; if (e.notice) notice = true; }
    if (text.trim() && !notice) return text.trim();
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  throw new Error("rate-limited repeatedly");
}

const PROGRAMS = ["py", "js", "ts", "rb", "php", "pl", "lua", "bas", "c", "cpp"];
const exts = [...PROGRAMS, "json", "md", "html", "css"].filter((e) => !only || only.includes(e));
const systemPrompt = buildSystemPrompt(instructions, {});
const results = [];
for (const ext of exts) {
  const name = LANGUAGES[ext]?.name ?? ext;
  const tasks = PROGRAMS.includes(ext)
    ? PROGRAM_TASKS.filter((t) => !(ext === "bas" && BASIC_SKIP.has(t.id)) && !((ext === "c") && C_SKIP.has(t.id)))
    : DATA_TASKS[ext];
  for (const task of tasks) {
    const filename = `main.${ext}`;
    // The learner is in an empty file of that language and asks for an
    // example — the way they would in the app.
    const q = `${task.ask} in ${name.replace(/^a /, "")}`;
    const reply = await complete(systemPrompt, buildUserContent({ trigger: "manual", question: q, filename, code: "", previousCode: null, runContext: "" }));
    const code = firstCode(reply, task.fence);
    let pass = false, detail = "";
    if (code == null) detail = "no code block in the reply";
    else if (task.check) {
      try { pass = Boolean(task.check(code)); detail = pass ? "" : "structure check failed"; } catch (e) { detail = `check threw: ${e.message}`; }
    } else {
      const r = await runIt(ext, code, task.inputs);
      const out = r.output.replace(/\r/g, "");
      pass = r.ok && task.expect.every((re) => re.test(out.trim()));
      detail = pass ? "" : (r.ok ? `output: ${JSON.stringify(out.slice(0, 200))}` : `error: ${String(r.error).slice(0, 300)}`);
    }
    results.push({ ext, task: task.id, pass, detail, reply });
    console.log(`${ext.padEnd(5)} ${task.id.padEnd(9)} ${pass ? "PASS" : "FAIL"}${detail ? `  ${detail.split("\n")[0].slice(0, 140)}` : ""}`);
  }
}

const byExt = {};
for (const r of results) { byExt[r.ext] ??= [0, 0]; byExt[r.ext][1]++; if (r.pass) byExt[r.ext][0]++; }
const summary = { label, model, passed: results.filter((r) => r.pass).length, total: results.length, byLanguage: Object.fromEntries(Object.entries(byExt).map(([e, [p, n]]) => [e, `${p}/${n}`])) };
const dir = path.join(__dirname, "results");
await mkdir(dir, { recursive: true });
const stamp = Date.now();
await writeFile(path.join(dir, `competency-${label}-${stamp}.json`), JSON.stringify({ summary, results }, null, 2));
const md = [`# Language competency — ${label} — ${model} — ${new Date().toISOString()}`, "", "```", JSON.stringify(summary, null, 2), "```", ""];
for (const r of results.filter((r) => !r.pass)) md.push(`## ${r.ext} ${r.task} — ${r.detail}`, "", r.reply, "");
await writeFile(path.join(dir, `competency-${label}-${stamp}.md`), md.join("\n"));
console.log("\n" + JSON.stringify(summary));
process.exit(0);
