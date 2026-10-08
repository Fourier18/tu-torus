// Builds THIRD_PARTY_NOTICES.txt: the licenses of everything Tu-Torus ships.
// Run before every package (npm run package does it), so the notices always
// match the installed packages.
//
// Part 1 covers the language engines. Their npm packages often leave out the
// licenses of what's compiled inside them (CPython, PHP, Perl, Lua…), so
// those texts are kept in scripts/licenses/, fetched from each project's
// official source. Part 2 is every npm package in the shipped server folder
// and the editor bundle, with the license files the packages include.
// Part 5 is where to get source code where a license asks for it.
//
// usage: node scripts/third-party-notices.cjs
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const LIC = path.join(__dirname, "licenses");
const OUT = path.join(ROOT, "THIRD_PARTY_NOTICES.txt");
const version = require(path.join(ROOT, "package.json")).version;
const text = (f) => fs.readFileSync(path.join(LIC, f), "utf8").replace(/\r\n/g, "\n").trim();
const pkgVersion = (dir, name) => JSON.parse(fs.readFileSync(path.join(ROOT, dir, "node_modules", name, "package.json"), "utf8")).version;
const rule = "=".repeat(78);
const thin = "-".repeat(78);
const out = [];
const section = (title) => out.push("", rule, title, rule, "");
const block = (title, body) => out.push(thin, title, thin, "", body.trim(), "");

// Packages that are in node_modules but not shipped (package.json "files"
// excludes them).
const NOT_SHIPPED = new Set(["@vercel/ncc"]);

out.push(
  `THIRD-PARTY SOFTWARE NOTICES — Tu-Torus ${version}`,
  "",
  "Tu-Torus includes software from the projects listed below. Each is used under",
  "its own license, reproduced or referenced here. Tu-Torus's own license is in",
  "the LICENSE file.",
);

// ---------------------------------------------------------------- Part 1
section("PART 1 — LANGUAGE ENGINES");

const py = pkgVersion("server", "pyodide");
block(`Python — Pyodide ${py} (Mozilla Public License 2.0)`, `
Python runs on Pyodide, which contains CPython 3.14 and libraries compiled into
it: bzip2, mpdecimal (libmpdec), liblzma (XZ Utils), SQLite, zlib, libffi and
expat. Pyodide source: https://github.com/pyodide/pyodide/tree/${py}

${text("pyodide-LICENSE.txt")}`);
block("CPython (Python Software Foundation License)", text("cpython-LICENSE.txt"));
block("CPython — licenses and acknowledgements for incorporated software (mpdecimal, zlib, libffi, expat and others)", text("cpython-Doc-license.rst"));
block("bzip2 / libbzip2 (compiled into Pyodide)", text("bzip2-LICENSE.txt"));
block("liblzma (XZ Utils) and SQLite (compiled into Pyodide)", `
liblzma is in the public domain (XZ Utils 5.4 and earlier) or under the BSD Zero
Clause License (5.6 and later); SQLite is in the public domain. Neither requires
a notice; they are listed so the contents are complete.`);

const php = pkgVersion("server", "php-wasm");
block(`PHP — php-wasm ${php} (Apache License 2.0), PHP 8.4.1 (PHP License 3.01, Zend Engine License 2.00)`, `
PHP runs on php-wasm, a WebAssembly build of PHP 8.4.1 (Zend Engine 4.4.1).
Compiled-in extensions: Core, date, libxml, pcre, bcmath, calendar, ctype,
json, filter, hash, SPL, session, standard, PDO, random, Reflection, exif,
tokenizer, and php-wasm's own extensions. The bcmath extension contains
libbcmath, licensed under the GNU Lesser General Public License 2.1 (text and
source information below; see also Part 5).

This product includes PHP software, freely available from
<http://www.php.net/software/>.

This product includes the Zend Engine, freely available at
<http://www.zend.com>.

php-wasm source: https://github.com/seanmorris/php-wasm/tree/v${php}`);
block("PHP License, version 3.01", text("php-LICENSE.txt"));
block("Zend Engine License, version 2.00", text("zend-LICENSE.txt"));
block("PHP — third-party code in PHP binaries (PHP's README.REDIST.BINS)", text("php-README.REDIST.BINS.txt"));
block("PHP — libbcmath (ext/bcmath): GNU Lesser General Public License 2.1", text("php-ext_bcmath_libbcmath_LICENSE.txt"));
block("PHP — libavifinfo (ext/standard)", text("php-ext_standard_libavifinfo_LICENSE.txt"));
block("PHP — libxml2 (MIT License)", text("libxml2-Copyright.txt"));

block(`Ruby — ruby.wasm ${pkgVersion("server", "@ruby/wasm-wasi")}, Ruby 3.4`, `
Ruby runs on ruby.wasm. Its license and the notices for the components inside
it (Ruby, LibYAML, zlib, wasi-libc, OpenSSL, wasi-vfs) ship with the package and
are reproduced in Part 2 under @ruby/3.4-wasm-wasi.`);

const zp = pkgVersion("server", "@6over3/zeroperl-ts");
block(`Perl — zeroperl-ts ${zp} (Apache License 2.0), zeroperl (MIT), Perl 5 (Artistic License)`, `
Perl runs on zeroperl, Perl 5 compiled to WebAssembly by the zeroperl project.
Perl is distributed under either the GNU General Public License or the Artistic
License; Tu-Torus distributes it under the Artistic License. zeroperl is a
non-standard build under a non-standard name; its differences from standard Perl
are documented by the zeroperl project (https://github.com/6over3/zeroperl and
https://github.com/6over3/zeroperl-ts). The Standard Version of Perl is
available from https://www.perl.org/get.html.

zeroperl-ts declares the Apache License 2.0 in its package.json and ships no
license file; the Apache License 2.0 text is reproduced under BASIC (qbjc)
below.`);
block("zeroperl (MIT License)", text("zeroperl-LICENSE.txt"));
block("Perl — The Artistic License", text("perl-Artistic.txt"));

block(`Lua — wasmoon ${pkgVersion("server", "wasmoon")} (MIT License), Lua 5.4 (MIT License)`, `
Lua runs on wasmoon, the official Lua 5.4 compiled to WebAssembly. wasmoon's own
license is in Part 2.

${text("lua-LICENSE.txt")}`);

block(`BASIC — qbjc ${pkgVersion("server", "qbjc")} (Apache License 2.0)`, `
Copyright Chuan Ji. qbjc source: https://github.com/jichu4n/qbjc

${text("qbjc-LICENSE.txt")}`);

block("Emscripten runtime (MIT License / University of Illinois/NCSA Open Source License)", `
Pyodide, php-wasm and wasmoon are built with Emscripten and include its runtime
code.

${text("emscripten-LICENSE.txt")}`);

// ---------------------------------------------------------------- Part 2
section("PART 2 — PACKAGES (npm)");
out.push("Every npm package shipped in the app's server folder and in the editor bundle,", "with the license files each package includes.", "");

const NOTICE_FILE = /^(licen[cs]e|copying|notice|thirdpartynotice)/i;
function licenseFiles(dir) {
  const found = [];
  for (const d of [dir, path.join(dir, "dist")]) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (NOTICE_FILE.test(f) && fs.statSync(p).isFile()) found.push(p);
    }
    if (found.length) break;
  }
  return found;
}
function describe(dir) {
  const pj = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const license = typeof pj.license === "string" ? pj.license : pj.license?.type || (pj.licenses || []).map((l) => l.type || l).join(" OR ") || "(not stated)";
  const repo = typeof pj.repository === "string" ? pj.repository : pj.repository?.url || pj.homepage || "";
  return { name: pj.name, version: pj.version, license, repo: repo.replace(/^git\+/, "").replace(/\.git$/, ""), dir };
}

// Server: every package under server/node_modules (the whole folder ships).
const packages = new Map();
function scanNodeModules(nm) {
  if (!fs.existsSync(nm)) return;
  for (const entry of fs.readdirSync(nm)) {
    if (entry.startsWith(".")) continue;
    const dirs = entry.startsWith("@") ? fs.readdirSync(path.join(nm, entry)).map((s) => path.join(nm, entry, s)) : [path.join(nm, entry)];
    for (const dir of dirs) {
      if (!fs.existsSync(path.join(dir, "package.json"))) continue;
      const info = describe(dir);
      if (!info.name || NOT_SHIPPED.has(info.name)) continue;
      packages.set(`${info.name}@${info.version}`, info);
      scanNodeModules(path.join(dir, "node_modules"));
    }
  }
}
scanNodeModules(path.join(ROOT, "server", "node_modules"));

// Editor bundle: the frontend's dependencies and theirs, as Node resolves them.
function resolvePackage(name, fromDir) {
  for (let d = fromDir; ; d = path.dirname(d)) {
    const p = path.join(d, "node_modules", name);
    if (fs.existsSync(path.join(p, "package.json"))) return p;
    if (path.dirname(d) === d) return null;
  }
}
function walkFrontend(dir) {
  const pj = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  for (const name of Object.keys(pj.dependencies || {})) {
    const p = resolvePackage(name, dir);
    if (!p) continue;
    const info = describe(p);
    const key = `${info.name}@${info.version}`;
    if (packages.has(key)) continue;
    packages.set(key, info);
    walkFrontend(p);
  }
}
walkFrontend(path.join(ROOT, "frontend"));

// Packages that ship no license file, whose text is given elsewhere here.
const COVERED = {
  "pyodide": "Mozilla Public License 2.0 — the full text is in Part 1, under Python.",
  "qbjc": "Apache License 2.0 — the full text is in Part 1, under BASIC.",
  "@6over3/zeroperl-ts": "Apache License 2.0 — the full text is in Part 1, under BASIC (qbjc).",
  "@ruby/wasm-wasi": "MIT License — ruby.wasm's license is reproduced under @ruby/3.4-wasm-wasi.",
  "railroad-diagrams": "CC0 1.0 Universal (public domain dedication) — no notice is required.",
};
for (const info of [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))) {
  const files = licenseFiles(info.dir);
  const body = files.length
    ? files.map((f) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n").trim()).join("\n\n")
    : COVERED[info.name] || `License: ${info.license}. The package includes no license file.`;
  block(`${info.name} ${info.version} — ${info.license}${info.repo ? ` — ${info.repo}` : ""}`, body);
}

// ---------------------------------------------------------------- Part 3
section("PART 3 — ELECTRON AND CHROMIUM");
out.push(
  "Tu-Torus runs on Electron, which includes Chromium and Node.js. Their licenses",
  "are in LICENSE.electron.txt and LICENSES.chromium.html, in the folder that",
  "contains Tu-Torus.exe.",
);

// ---------------------------------------------------------------- Part 4
section("PART 4 — DOWNLOADED ON FIRST USE");
block("C and C++ compiler — YoWASP Clang (Apache License 2.0), LLVM (Apache License 2.0 with LLVM Exceptions)", `
The first time a .c or .cpp file is run, Tu-Torus downloads the YoWASP build of
Clang from the npm registry (https://www.npmjs.com/package/@yowasp/clang) and
keeps it in the data folder. It is not part of the installer.
Source: https://github.com/YoWASP/clang and https://github.com/llvm/llvm-project

${text("yowasp-clang-LICENSE.txt")}

${text("llvm-LICENSE.txt")}`);

// ---------------------------------------------------------------- Part 5
section("PART 5 — SOURCE CODE");
out.push(`Python (Pyodide, Mozilla Public License 2.0): the source of the Pyodide build
included in Tu-Torus is at https://github.com/pyodide/pyodide/tree/${py}

PHP (libbcmath, GNU Lesser General Public License 2.1): the PHP engine is
php-wasm ${php}, a WebAssembly build of PHP 8.4.1 in which libbcmath is compiled.
Its complete corresponding source is PHP 8.4.1
(https://github.com/php/php-src/tree/php-8.4.1) together with php-wasm's build
(https://github.com/seanmorris/php-wasm/tree/v${php}), from which the engine can
be modified and rebuilt.

Written offer: for at least three years from the date you received this copy of
Tu-Torus, we will provide the complete corresponding source code of that PHP
engine, including libbcmath, for a charge no more than the cost of performing
the distribution. Ask by opening an issue at
https://github.com/Fourier18/tu-torus/issues.

Perl: the Standard Version is at https://www.perl.org/get.html; zeroperl's
source is at https://github.com/6over3/zeroperl.
`);

// ---------------------------------------------------------------- Part 6
// From server/knowledge/sources.json, the one list of the tutor's outside
// sources. knowledge-sources.test.mjs checks every attribution appears here.
section("PART 6 — TEACHING AND REFERENCE MATERIAL");
const { sources } = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "knowledge", "sources.json"), "utf8"));
const shippedKnowledge = sources.filter((s) => s.files.length);
out.push(
  "Material from the works below is included in Tu-Torus (server/knowledge) under",
  "each work's license. The tutor's teaching principles (server/knowledge/",
  "doctrine.md) are written for Tu-Torus and draw on the works listed after them.",
  "",
);
for (const s of shippedKnowledge) block(`${s.title} — ${s.license}`, `${s.attribution}\nLicense: ${s.license_url}\nChanges: ${s.changes}\nIncluded: ${s.files.join(", ")}`);
block("Works the tutor's teaching principles draw on (not included in Tu-Torus)", sources.filter((s) => !s.files.length).map((s) => `${s.attribution}\n  License: ${s.license}`).join("\n\n"));

fs.writeFileSync(OUT, out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n");
console.log(`THIRD_PARTY_NOTICES.txt: ${packages.size} npm packages, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
