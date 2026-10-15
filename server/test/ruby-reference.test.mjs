// The Ruby documentation attached to tutor messages (ruby-reference.js,
// knowledge/ruby-3.4/reference.json). Covers documented failure modes:
// puts blank-line myth, elsif vs elif, gets needing chomp.
//
// usage: node server/test/ruby-reference.test.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rubyReferenceFor, REFERENCE_BUDGET } from "../src/ruby-reference.js";
import { buildUserContent } from "../src/tutor.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const { entries } = JSON.parse(readFileSync(path.join(dir, "..", "knowledge", "ruby-3.4", "reference.json"), "utf8"));

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${JSON.stringify(detail)}`}`); if (!ok) failed++; };
const where = (block) => [...block.matchAll(/^\[(.+)\]$/gm)].map((m) => m[1]);
const excerptChars = (b) => b.split(/\n\n(?=\[)/).slice(1).reduce((n, part) => n + part.replace(/^\[.+\]\n/, "").length, 0);

// ---- reference JSON --------------------------------------------------------
for (const k of ["puts", "print", "p", "gets", "chomp", "to_i", "to_f", "to_s", "if", "while", "def", "each", "times", "nil", "NoMethodError", "NameError"]) {
  check(`has an entry for ${k}`, Array.isArray(entries[k]) && entries[k].length > 0, k);
}

// The documented failure mode: puts adds one newline only.
check("puts: corrects the blank-line myth", entries.puts[0].text.includes("no blank line between them"), entries.puts[0].text.slice(0, 200));
check("puts: explains how to print a blank line", entries.puts[0].text.includes("puts with no argument") || entries.puts[0].text.includes("no argument"), entries.puts[0].text.slice(0, 200));

// The documented failure mode: elsif vs elif.
check("if: names elsif not elif", entries.if[0].text.includes("elsif"), entries.if[0].text.slice(0, 200));
check("if: explains why elif looks valid", entries.if[0].text.includes("NoMethodError") || entries.if[0].text.includes("method named elif"), entries.if[0].text.slice(0, 300));

// ---- a typical beginner program --------------------------------------------
const greeter = `
name = gets.chomp
age = gets.chomp.to_i

if age >= 18
  puts "Hello, #{name}! You are an adult."
elsif age >= 13
  puts "Hello, #{name}! You are a teenager."
else
  puts "Hello, #{name}!"
end

3.times do |i|
  puts i
end
`;

let block = rubyReferenceFor({ code: greeter });
let got = where(block);
for (const expected of ["Kernel#gets", "String#chomp", "String#to_i", "Ruby 3.4 Reference, if"]) {
  check(`greeter: attaches ${expected}`, got.some((g) => g.includes(expected)), got);
}
check(`greeter: attaches times`, got.some((g) => /times/i.test(g)), got);
check(`greeter: attaches puts`, got.some((g) => /Kernel#puts/.test(g)), got);
check(`greeter: within the budget`, excerptChars(block) <= REFERENCE_BUDGET, excerptChars(block));

// ---- strings and comments don't count as uses ------------------------------
const onlyStrings = rubyReferenceFor({ code: '# puts something\nresult = "puts it away"' });
check("puts in a comment/string doesn't trigger the entry", !onlyStrings.includes("Kernel#puts"), onlyStrings.slice(0, 100));

// ---- question keys ---------------------------------------------------------
const justPuts = rubyReferenceFor({ code: "x = 1", question: "does puts add a blank line?" });
check("question about puts: attaches puts entry", justPuts.includes("Kernel#puts"), "");

const justElsif = rubyReferenceFor({ code: "x = 1", question: "why does `elsif` work but not `elif`?" });
check("question about elsif: attaches if entry", justElsif.includes("Ruby 3.4 Reference, if"), "");

const englishWords = rubyReferenceFor({ code: "x = 1", question: "can you help me print my name for my class" });
check("English words (help, for, class) don't trigger lookups when not in code", englishWords === "" || !where(englishWords).some((w) => /class|for/.test(w)), where(englishWords));

// ---- error keys ------------------------------------------------------------
const withError = rubyReferenceFor({ code: "x = 1", errorText: "NoMethodError: undefined method 'length' for nil" });
check("NoMethodError in error text: attaches NoMethodError entry", withError.includes("NoMethodError"), "");

const withNameError = rubyReferenceFor({ code: "puts result", errorText: "NameError: undefined local variable or method 'result'" });
check("NameError in error text: attaches NameError entry", withNameError.includes("NameError"), "");

// ---- budget ----------------------------------------------------------------
check("small budget is kept", excerptChars(rubyReferenceFor({ code: greeter, budget: 500 })) <= 500, "");

// ---- null / empty inputs ---------------------------------------------------
check("null code returns empty string", rubyReferenceFor({ code: null }) === "", "");
check("file with no known identifiers returns empty string", rubyReferenceFor({ code: "x = 1 + 2\ny = x * 3" }) === "", "");

// ---- buildUserContent wires it correctly -----------------------------------
check("buildUserContent: .rb gets the Ruby documentation", buildUserContent({ trigger: "check", filename: "hello.rb", code: 'puts "hello"' }).includes("Ruby documentation"), "");
check("buildUserContent: .py does not get the Ruby documentation", !buildUserContent({ trigger: "check", filename: "main.py", code: "print('hi')" }).includes("Ruby documentation"), "");
check("buildUserContent: .js does not get the Ruby documentation", !buildUserContent({ trigger: "check", filename: "main.js", code: "console.log(1)" }).includes("Ruby documentation"), "");

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
