// [DESIGN.md, Panel 3] Every Run writes a run record; each is attached to the
// tutor once, automatically, on the user's next message. Keep last 20.
import { writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { TUTOR_DIR } from "./paths.js";

const RUNS_DIR = path.join(TUTOR_DIR, "runs");
const KEEP = 20;
const OUTPUT_HEAD = 4000;
const OUTPUT_TAIL = 4000; // keep head+tail, never cut the error — errors print at the end

function capOutput(text) {
  if (text.length <= OUTPUT_HEAD + OUTPUT_TAIL) return text;
  const cutBytes = text.length - OUTPUT_HEAD - OUTPUT_TAIL;
  return `${text.slice(0, OUTPUT_HEAD)}\n...[${cutBytes} characters cut — full output saved in this run's file]...\n${text.slice(-OUTPUT_TAIL)}`;
}

async function nextRunNumber() {
  await mkdir(RUNS_DIR, { recursive: true });
  const files = (await readdir(RUNS_DIR)).filter((f) => f.endsWith(".md"));
  const nums = files.map((f) => parseInt(f, 10)).filter((n) => !Number.isNaN(n));
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

async function pruneOldRuns() {
  const files = (await readdir(RUNS_DIR)).filter((f) => f.endsWith(".md")).sort();
  for (const f of files.slice(0, -KEEP)) await unlink(path.join(RUNS_DIR, f));
}

export async function writeRunRecord({ filename, code, output, error }) {
  const n = await nextRunNumber();
  const id = String(n).padStart(3, "0");
  const relPath = `.tutor/runs/${id}.md`;

  const body = [
    `# Run ${n} — ${filename}`,
    "",
    "## Code as run",
    "```",
    code,
    "```",
    "",
    "## Output",
    "```",
    capOutput(output || "(no output)"),
    "```",
    error ? `\n## Error\n\`\`\`\n${error}\n\`\`\`` : "\n## Error\n(none)",
  ].join("\n");

  await writeFile(path.join(RUNS_DIR, `${id}.md`), body);
  await pruneOldRuns();

  return {
    runId: n,
    relPath,
    ok: !error,
    pointer: `Last run: #${n}, ${filename}, ${error ? "error" : "ok"} — record in ${relPath}`,
  };
}
