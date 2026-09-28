// prompt() and alert() for JavaScript and TypeScript files. Browser tutorials
// teach beginners `prompt("Name?")` for input, and the tutor wrote it too —
// but in Node it's "prompt is not defined". Here prompt shows its message and
// waits for a line typed in the input box, like the other languages' input;
// alert just shows its message. Loaded before the learner's file
// (languages.json: node --require; ts.mjs requires it itself).
const fs = require("fs");
const { readLine } = require("./stdin-sync.cjs");

// Written synchronously so the question appears before the program blocks
// waiting for the answer (console.log to a pipe can still be queued).
const show = (text) => fs.writeSync(1, text);

globalThis.prompt = (message = "", defaultValue) => {
  if (message !== "") show(`${message} `);
  const line = readLine();
  if (line == null) return defaultValue ?? null;
  return line.replace(/\r?\n$/, "");
};
globalThis.alert = (message = "") => { show(`${message}\n`); };
