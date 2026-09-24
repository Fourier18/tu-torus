// [DESIGN.md, R6] Single source of truth lives on the backend
// (server/src/languages.json) — fetched once, not hardcoded here a second
// time, so the two can never drift apart.
let table = {};
export const languagesReady = fetch("/api/languages")
  .then((r) => r.json())
  .then((data) => { table = data; })
  .catch(() => {}); // a failed/slow fetch here must never block the whole app on "Loading…" — this only degrades to plain-text highlighting and non-native rendering, nothing functional

function entry(filename) {
  return table[filename.split(".").pop().toLowerCase()] || {};
}

export function isBrowserNative(filename) {
  return !!entry(filename).browserNative;
}

// Monaco falls back to plain text for anything not in the table, which is a
// safe default, not a failure — the file still opens, runs, and is readable.
export function monacoLanguage(filename) {
  return entry(filename).monaco || "plaintext";
}
