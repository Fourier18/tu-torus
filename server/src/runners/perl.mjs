// Perl, built in: Perl 5 compiled to WebAssembly (zeroperl).
// usage: node perl.mjs <file.pl>
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire, syncBuiltinESMExports } from "node:module";
import fsp from "node:fs/promises";
// zeroperl finds its engine via new URL(...).pathname, which on Windows is
// "/C:/..." � not a readable path. Fix just that shape before it loads.
const realReadFile = fsp.readFile;
fsp.readFile = (p, ...rest) => realReadFile(typeof p === "string" && /^\/[A-Za-z]:\//.test(p) ? decodeURIComponent(p.slice(1)) : p, ...rest);
syncBuiltinESMExports();
const { ZeroPerl, MemoryFileSystem } = await import("@6over3/zeroperl-ts");
const { readLine } = createRequire(import.meta.url)("./stdin-sync.cjs");
const file = process.argv[2];
const name = path.basename(file);
const text = (d) => (typeof d === "string" ? d : Buffer.from(d).toString("utf8"));
const fs = new MemoryFileSystem({ "/": "" });
fs.addFile("/" + name, readFileSync(file, "utf8"));
let perl;
const perlReady = ZeroPerl.create({
  fileSystem: fs,
  // Perl asks for input: show anything it printed first, then wait for a line.
  stdout: (d) => process.stdout.write(text(d)),
  stderr: (d) => process.stderr.write(text(d).replace(/\(eval \d+\)/g, name)),
});
perl = await perlReady;
// zeroperl's create() doesn't pass a stdin callback through, so STDIN is
// tied to a Perl class that asks the host for each typed line.
perl.registerFunction("__tu_readline", () => {
  perl.flush();
  const line = readLine();
  return line === null ? perl.createUndef() : perl.createString(line);
});
await perl.eval(`
package TuStdin;
sub TIEHANDLE { return bless {}, shift }
sub READLINE {
  if (wantarray) { my @lines; while (defined(my $l = main::__tu_readline())) { push @lines, $l } return @lines }
  return main::__tu_readline();
}
sub EOF { return 0 }
sub CLOSE { return 1 }
package main;
tie *STDIN, 'TuStdin';
$| = 1;
`);
const result = await perl.runFile("/" + name);
perl.flush();
if (!result.success && result.error) process.stderr.write(String(result.error).replace(/\(eval \d+\)/g, name).trim() + "\n");
process.exitCode = result.success ? 0 : 1;
perl.dispose();
