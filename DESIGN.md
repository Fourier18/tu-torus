# Tu-Torus — Design

How Tu-Torus works as of version 1.7. The decisions behind it are in [docs/adr](docs/adr/), the story in [docs/HISTORY.md](docs/HISTORY.md), and the design log of the first builds (revisions 1–20, where code comments' "[DESIGN.md, R…]" references point) in [docs/history/design-revisions.md](docs/history/design-revisions.md). That log also records the early Claude sign-in and its removal before the first release.

## The three panels

- **Panel 1 — editor.** Monaco, bundled with the app. Any file name and ending; the ending picks the language. Saves about 2 seconds after typing stops (written to a temporary file and renamed, so a crash can't leave half a file). The ▾ menu lists the learner's files and creates new ones. Editor suggestions are off by default.
- **Panel 2 — output.** Run becomes Stop while a program runs (Ctrl+C in the input box too). Typed input goes in the box under the output and is echoed like a terminal. A program is stopped after 200,000 characters of output, or 15 seconds without finishing (time waiting for input isn't counted). Web pages render in a sandboxed frame. Run on a JSON file checks it.
- **Panel 3 — tutor.** Answers typed questions and "Check my code". It sees the open file, what changed since its last reply, how that language runs in this app, and the last run (output and error). It doesn't fire on its own.

## How it's built

- **Electron main process** (`electron/`): one instance at a time; starts the server on port 4310, or a free port if that's taken; encrypts and decrypts the API key for the server ([ADR 6](docs/adr/0006-api-key-encrypted-with-the-windows-account.md)); keeps the window on the app and sends ordinary web links to the browser.
- **Server** (`server/src/index.js`): Express and a WebSocket (`/run`) on 127.0.0.1 only, answering only requests from the app itself (host and origin checks, `security.js`). File names are checked (no folders, nothing hidden, no names Windows reserves).
- **Languages** (`server/src/languages.json`): the one table of what runs and how, read by both server and page. Python runs on Pyodide in a worker thread (`engines/python.js`); everything else as a subprocess (`engines/toolchain.js`) — the built-in languages on Electron's own Node through the runners in `server/src/runners/`, installed toolchains (Go, Java, C#, Rust) directly. C/C++ use a compiler downloaded on first use ([ADR 3](docs/adr/0003-c-compiler-on-first-use.md)).
- **Tutor** (`server/src/tutor.js`, `tutor-instructions.md`): builds each message (the question, the file — at most 40,000 characters — the change note, the language's runtime note, the last run — at most 20,000), adds the learner notes and the private-run tool, and calls the provider (`providers/openai-compatible.js`: any OpenAI-compatible service, the learner's own key, plain messages for every failure, time limits) ([ADR 2](docs/adr/0002-bring-your-own-ai-provider.md)).
- **Private runs** (`tools/run-learner-code.js`, `runner.js` runPrivately): the tutor may run the learner's current file with inputs it chooses, as a restricted subprocess — own temporary folder only, no other programs, no network, no environment ([ADR 4](docs/adr/0004-tutor-checks-by-running-code.md)).
- **Learner notes** (`learner-notes.js`): short notes the tutor keeps on how the learner is doing, updated after replies, shown and editable in Settings (lines starting with `*` are pinned).
- **Data** ([ADR 5](docs/adr/0005-learner-data-outside-the-install-folder.md)): `%APPDATA%\tu-torus\workspace` for files, `workspace\.tutor` for settings, run records (last 20) and notes, `tools` for the C/C++ compiler.
- **Updates and support**: once a day (if allowed) the app asks GitHub's releases list for a newer version and shows a note; Settings → About has the licenses, a copy of the details a bug report needs, and a link to the report form.

## Testing

- Automatic, no API calls: `server/test/languages.test.mjs`, `private-run.test.mjs`, `settings.test.mjs`, `provider-errors.test.mjs`, `python-engine.test.mjs`, `keyring.electron.cjs` (real Electron), `scripts/check-contrast.mjs`.
- Tutor quality, against real runs: `tutor-logic-suite.mjs` (syntax rules with pushback; graded by a grader calibrated against independent labels, `judge-calibration.mjs`), `language-competency.mjs` (the tutor's examples run in every language), `tutor-adversarial.mjs` (honesty under pressure), `student-sim.mjs` (simulated learners, with the outcome checked).
- `scripts/release-gate.mjs` runs the automatic checks before every release (`--tutor` adds the held-out tutor suite).
