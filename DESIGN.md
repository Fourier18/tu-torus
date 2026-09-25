# Tu-Torus — Design (frozen reference)

This is the settled design. If a future answer contradicts this file, the file wins — that's a bug to fix, not a new version of the plan.

Revision 2 (2026-09-23): Opus review pass. Changes are marked **[R2]**.
Revision 4 (2026-09-23): any-language correction — HTML/CSS were examples, not the limit. Changes are marked **[R4]**.
Revision 5 (2026-09-23): Piston wired in and confirmed working — Python and JavaScript both tested end to end (crash, real interactive stdin, and a second language through the identical code path), through the real browser UI, not just the API. Docker installed and running on this machine (a WSL fix and a Docker Desktop restart were both needed first). Build-order steps 1 and 2 are done.
Revision 6 (2026-09-23): killed "render modes" language for good — the output panel behaves like a browser, automatically, with no toggle and no concept of modes exposed anywhere. Changes are marked **[R6]**.
Revision 7 (2026-09-23): validated the any-language claim for real, not just in the design — Rust ran successfully through the exact same path as Python/JS with zero entry anywhere in our language table, resolved automatically against Piston's own runtime list (the R4 fallback, now proven, not just written down). Found and fixed a real bug along the way: compiled languages send two `exit` events (compile, then run) — the runner was treating the first as final and never seeing the actual program run. Also: `languages.json` is now the single source of truth for both the backend (what runs) and the frontend (syntax highlighting, browser-native detection) via `GET /api/languages`, so the two can't drift apart the way they could before this revision. A file-name field now exists in the UI, so a different language is actually reachable by typing a filename — before this, the "any language" backend had no way to be triggered from the app itself.
Revision 8 (2026-09-23): found a real tutor accuracy gap by testing a history question ("what languages have we run?") — it answered from file names alone (wrong) instead of reading the actual run records, because each API call is a stateless conversation with no memory of earlier ones. Fixed with an explicit instruction in `tutor-instructions.md` to read `.tutor/runs/` before answering any question about the past, never guess from what currently exists on disk. Retested the identical question — now reads all 12 run records and answers correctly.
Revision 9 (2026-09-23): Settings UI built (model picker, theme picker) and the swappable-theme claim tested for real — `theme-dark.css` is an actual second file, activated by `data-theme` on the root element, added without touching a single component. Confirmed via the real control: switching to dark in the UI changed the rendered background color to the exact dark token value and persisted to `.tutor/settings.json`. Switched back to light (the intended default) after confirming.
Revision 10 (2026-09-24): fixed a real gap in a case nobody had tested — an extension Piston has no runtime for at all. Before this, the output panel showed the same generic "Program stopped with an error" line for that as for an actual bug in the learner's code, with no way to tell them apart, and the real reason never even reached the browser (only the run record). Added a `preExecution` distinction: a failure before Piston ever confirmed a runtime shows its plain, specific reason directly in the output panel; an actual program crash still shows only the generic line, with the full error going to the run record for the tutor, unchanged. Verified both paths at the protocol level and in the real browser.
Revision 11 (2026-09-24): found and fixed a real dead-end — killed the backend mid-run (while the output panel was genuinely waiting on stdin) and confirmed the UI got permanently stuck on "Running…" with no recovery except a page reload, because nothing listened for the WebSocket closing unexpectedly. Added a distinction between a real exit and a dropped connection: the panel now shows "Lost connection to the run server." and re-enables Run. Retested the full cycle after restarting the backend — a fresh run works normally again, no leftover bad state.
Revision 12 (2026-09-24): applied the same disconnect scrutiny to the tutor chat and the app's own startup, and found two more real dead-ends. (1) `TutorChat.jsx` had no error handling at all — killed the backend and confirmed sending a message left the input permanently disabled, no message, no recovery. Added try/catch/finally: a failed request or a stream that dies mid-answer now shows "Lost connection to the tutor. Try asking again." and re-enables the input. (2) The app's own first load had the same gap one level up — killed the backend before opening the page at all, and it hung forever on "Loading…" because the initial file fetch (unlike the languages and settings fetches, which were already guarded) had no `.catch()`. Fixed the same way. Retested all three — backend down at launch, tutor request killed mid-flight, then a full restart-and-recover — all confirmed working in the real browser.
Revision 13 (2026-09-24): fixed a silent-failure risk in autosave specifically, since it's the mechanism the tutor's whole "read the current code" trust depends on — a save that silently fails means the tutor coaches against code the learner already changed, with nobody aware anything went wrong. Added a small indicator (only visible when something's actually wrong, per the "no clutter" rule) that appears the moment a save fails and clears itself on the next successful one. Tested by killing the backend, typing (confirmed the indicator appeared), restarting, and typing again (confirmed it cleared and the correct final content reached disk).
Revision 14 (2026-09-24): last one in this pass — the file-rename field had the same unguarded fetch. Killed the backend and confirmed renaming would leave the filename box showing a name that was never actually loaded, silently disagreeing with what the editor still held. Fixed: a failed rename snaps the field back to the file that's actually open. Retested after restarting the backend — a real rename works normally.
Revision 15 (2026-09-24): closed out the disconnect-resilience pass — grepped every `fetch`/`WebSocket` call in the frontend to confirm nothing was missed, and found the last one: `Settings.jsx`'s save was optimistic (applies instantly) with no rollback if the save actually failed, so a change could appear to work while silently not persisting. Fixed with a rollback on failure. Tested by killing the backend and switching the theme — confirmed it applied then snapped back once the save failed — then restarted and confirmed a real change now applies and sticks. Every network call in the frontend has now been deliberately tested against the backend being down, not just written defensively and assumed to work.
Revision 16 (2026-09-24): also confirmed usage logging actually works, not just built — `.tutor/usage.log` has real entries from real tutor calls across this whole session, including confirmation that prompt caching is genuinely active (tens of thousands of `cache_read_input_tokens` per call). Separately, fixed a real completeness gap: starting the app required three manual steps in three terminals with no single entry point. Added a root `package.json` (`npm run setup`, `npm run piston`, `npm run dev`) and a `README.md`. Tested from a fully cold state — killed both servers, ran `npm run dev`, confirmed both came up and the app worked correctly through the browser.
Revision 17 (2026-09-24): correction — `npm run dev` from a terminal is not "an app" to someone who isn't a developer, and calling the result of Revision 16 a finished product was wrong. Built an actual double-clickable path: `Start Tu-Torus.bat` (starts Docker if it isn't running, starts Piston, starts both servers, waits for the app to actually be up, opens the browser automatically) and `Stop Tu-Torus.bat`, plus a **Tu-Torus** shortcut on the Desktop pointing at the start script. Tested exactly like a real double-click would happen — killed both servers first, launched the script, confirmed the app came up within seconds with no terminal typing required. Honest about what this still isn't: not a packaged installer, and it still depends on Node, npm, and Docker already being installed on this machine — it doesn't make the app portable to a computer that doesn't have this project set up.
Revision 3 (2026-09-23): all six proposals accepted. Changes are marked **[R3]**.

## Vision

A live-tu-torus app. Three panels. Any language, no setup step, no language menu. Claude is the default tutor; built so other model providers can be added later without a rewrite. Built to scale beyond personal use.

## Panel 1 — Editor

- Monaco or CodeMirror, embedded, with named files/tabs.
- **[R2] Language comes from the file name** (`main.py`, `index.html`, `hello.rs`), the way every editor already works. No dropdown, no model call. (Rev 1 said Claude would detect the language on every Run — that would have added seconds of delay and a tutor call to every Run, breaking the "tutor only acts when asked" rule.)
- Autosaves ~2 seconds after typing stops. **[R3] The tutor reads your current code from disk when a question needs it, so autosave is what keeps the tutor current.** (Reverses R2's "the tutor doesn't need it.")

## Panel 2 — Output canvas

**[R6] The output panel behaves like a browser, not a tool with settings.** A browser never asks you to turn on a "render HTML" mode — it just shows you what the content is. This panel works the same way: there is no mode, no toggle, nothing the user or the tutor ever selects. Never describe this as having "modes" again — say what it does (shows content the way a browser would), not how many branches the code has internally.

What that means concretely, with no user-visible seam between the two:

- A file a browser can open directly (HTML, SVG, an image, plain text) is shown directly, the same as double-clicking it would.
- A file that needs a language runtime to produce anything runs on whichever engine `languages.json` configures for it, and its output — text, almost always — is shown as that.

The extension-to-runner mapping is a config table (extension → how to run it), never a hardcoded if/else, so adding a language is adding a row, not a code change.

**[R18] Execution engine, corrected — no Docker, no Piston.** Earlier revisions (5, 7, 10) built this on self-hosted Piston, which needs Docker. That was solving the wrong problem: Piston/Judge0-style sandboxing exists to defend a *shared server* from *strangers'* code. This app has neither — it's one person running their own code on their own machine, the same as opening a terminal themselves. There's no attacker in that model, so container-grade isolation was never actually required; what matters is ordinary hygiene. Current engines, dispatched per extension:
  - **Pyodide, in a worker thread** (`server/src/engines/python.js` + `python-worker.js`) for Python. Runs in-process, bundled with the app — no install, no daemon. Real interactive `input()` works via a `SharedArrayBuffer` + `Atomics.wait`/`notify` bridge between the worker (which genuinely blocks) and the main thread (which holds the live WebSocket) — this is the standard pattern for blocking stdin in a worker/WASM setup, confirmed with a timestamped test proving the block is real, not pre-buffered.
  - **A local toolchain, run as a plain subprocess** (`server/src/engines/toolchain.js`) for everything else — whatever compiler/interpreter is already on the machine (`node`, `rustc`, `go`, `gcc`, `ruby`, `php`, etc.), detected via `where`/`which`. Hygiene, not isolation: a 15s hard timeout, the whole process tree killed on timeout (not just the parent), output capped, and a fresh throwaway temp directory per run. If a language's toolchain isn't installed, that's said plainly (`"<command> isn't installed... install it to run .<ext> files"`) rather than failing silently or hanging.
  - Confirmed working, for real, not assumed: Python, JavaScript (via `node`), and Rust (compile-then-run via `rustc`, proving the two-stage path). Go correctly shows the "not installed" message rather than crashing. C#, and several others in the table, are configured but not yet verified against an installed toolchain on this machine — say so if asked, don't claim they're tested.

Input:

- **[R2] An input line is present whenever a program is running** and takes focus when output goes quiet; it disappears when the program ends. Neither engine above signals "now waiting for input" distinctly from other output, so this stays the right design.

Errors:

- **[R2] If the program crashes, the canvas shows one plain line** ("Program stopped with an error"). The full error text goes into the run record for the tutor. (Rev 1 showed stdout only, so a crash would have left a blank panel.)

**[R2] Known limits (not being built now):** programs that open desktop windows (Python turtle, pygame, matplotlib pop-ups) won't display; Pyodide's Python has no internet access and only the standard library unless a package is explicitly loaded.

## Panel 3 — Tutor chat

- **Claude Code, appearing as a panel** — the same thing the Claude panel in VS Code is. Built with the Claude Agent SDK, which is Claude Code packaged for putting inside another app.
- **Two sign-in options, both core:** Claude subscription or API key. Chosen at setup. (Verified 2026-09-23: subscription sign-in is currently allowed, per the Claude Help Center, June 16 2026.)
- **[R18] Built behind a real provider interface, not just described as one.** `server/src/providers/claude.js` (default) and `server/src/providers/custom.js` (a generic OpenAI-compatible-API adapter — covers most local servers like Ollama/LM Studio and most cloud providers with one implementation, configured via an onboarding form in Settings rather than a separate integration per vendor) both yield the same normalized `{type:'text'|'done', ...}` shape; `server/src/tutor.js` is a thin router between them. The custom path has no agentic tool-use loop (an arbitrary third-party model can't be trusted to honor the same file-access restrictions enforced at the tool level for Claude), so it's handed the relevant run-record content directly instead of reading files itself — a disclosed tradeoff, not a hidden gap.
- **Strictly reactive.** Never interrupts. Never edits the code.
- **[R3] What the tutor gets, and when:**
  - Every Run writes a **run record** file: run number, file name, the code as it was run, the output, the full error.
  - **Each run record is shown to the tutor once, automatically, attached to your next message.** No new run since your last message → nothing is attached.
  - Anything else (your current code, older runs) the tutor reads itself, only when your question needs it.
  - Every message ends with a one-line pointer (e.g. "Last run: #7, main.py, error — record in `.tutor/runs/007.md`") so the tutor always knows what exists without it being pasted in.
  - (Replaces R2, which attached last-run code + output + error + current code to *every* message.)
- **[R3] Three read-only tools only:** read file, find files, search files. No edit, write, or shell tools — this enforces "never edits your code," and a small tool list is sent with every call instead of Claude Code's full set. **This list must be built as a setting the backend passes in, not a hardcoded assumption** — so the future opt-in "live suggestions" toggle can add an edit tool for that mode later without a rewrite.
- **[R3] Short tutor instructions of our own**, not Claude Code's full coding-agent instructions (which are long and tell it to write code — the opposite of this job). Fixed text: no dates, file names, or anything that changes, so every call reuses the cache.
- **[R3] Loads none of your personal Claude Code setup** (CLAUDE.md, plugins, skills, MCP servers).

## Usage / context handling

**[R3] Estimate** (30-message session, ~100-line script, half the messages come after a new Run):

| Plan | Tokens added per message | Tokens processed over the session |
|---|---|---|
| R2: attach everything to every message | ~2,600 | ~1.2M |
| Tutor reads everything itself | ~1,350, plus an extra round trip on debug questions | ~0.95M |
| **R3: each run attached once + tutor reads the rest** | ~1,350, no extra round trip for "what happened?" | **~0.63M** |

About half of R2. It also stops the conversation from filling up with old copies of the same file.

Rules:

1. **[R3] Run record cap keeps the first and last part of the output**, never cuts the error, and saves the full output to the run file for the tutor to search. (R2's plain size cap would have cut off the end — which is where error messages are.)
2. **[R3] Keep the last 20 run files**, delete older ones.
3. Prompt caching and conversation compaction are built into the Agent SDK in both sign-in modes — nothing to build.
4. **[R3] Default to the mid-tier Claude model**, changeable in settings — this moves cost more than anything above.
5. **[R3] Log token usage per message** from day one, so any further tuning is based on real numbers, not estimates.

Not adopted: sub-agents (one tutor, nothing to split); custom trimming of old messages (the SDK's compaction handles it; add only if the usage log shows a need).

## Build order

1. **[R3] Test the tutor instructions by hand** on a few broken beginner scripts before building anything, to confirm it teaches the way you want.
2. Prove Piston runs on this machine.
3. Build.

## Visual

- Light theme by default, built as a swappable token layer so a second theme later is a new file, not a rewrite.

## Stack

- Frontend: React — editor, output canvas (text mode + sandboxed iframe mode), chat.
- Backend: a thin server holding the run-engine dispatcher (Pyodide + local toolchains, `server/src/runner.js`) and the tutor provider router (`server/src/tutor.js`).
- Packaging: Electron (`electron/main.js`), built as a real Windows installer via `npm run package` — no Docker, no separate Node.js install required to run it.

Revision 18 (2026-09-24): the full Docker/Piston removal and Electron packaging pass — the single biggest architecture change since the original design. Summary, with the real bugs found along the way (each one found by actually testing, not assumed):

- **Execution engine replaced.** Piston/Docker are gone entirely. Python runs on Pyodide in a worker thread (`server/src/engines/python.js` + `python-worker.js`) with real blocking interactive `input()` via `SharedArrayBuffer`/`Atomics` — proven with a timestamped test, not just claimed. Everything else runs via an installed local toolchain as a plain subprocess (`server/src/engines/toolchain.js`) — hygiene (timeout, process-tree kill, output cap, throwaway temp directory), not container isolation, because this app's real threat model is one person running their own code on their own machine, not a shared server defending against strangers.
- **Two real bugs found in the Python engine itself, both by testing:** (1) Pyodide's `batched` stdout only flushes on a newline, so `input()`'s prompt (no newline) sat unflushed — switched to `raw`. (2) The `raw` fix was then defeated by `Atomics.wait()` blocking the worker's whole event loop, microtask queue included, so a *deferred* flush never actually sent until after the block ended — fixed by posting immediately, no deferral. Also fixed: per-byte decoding was mangling multi-byte UTF-8; switched to `TextDecoder`'s streaming mode.
- **Provider abstraction actually built, not just described.** `server/src/providers/claude.js` (default) and `custom.js` (a generic OpenAI-compatible adapter — covers most local servers and most cloud providers with one implementation) both yield the same normalized shape; `tutor.js` routes between them. Onboarding lives in Settings, not a config file.
- **Packaged as a real Electron app**, not a `.bat` file — a genuine installer, a real window (no browser chrome, correct taskbar title — the default Vite scaffold title ("frontend") was still showing in the title bar until caught and fixed, with the window title also locked against being overridden by the page's own `<title>` tag going forward).
- **The packaged app's Claude tutor connection failed for a real, subtle reason, found only after extensive isolated reproduction:** the Agent SDK spawns its bundled `claude.exe` using the same `cwd` the app configures for the tutor's own file access — but `workspace/` was never included in what gets packaged, so in the installed app that directory didn't exist at all. Windows' `CreateProcess` can fail with `ENOENT` for a *missing working directory*, not just a missing executable, which is exactly why the SDK's own error message ("binary exists but failed to launch") was misleading — the binary was always fine. Fixed at the source in `paths.js`, which now creates the directory itself rather than depending on a packaging `files` glob staying in sync. Several other plausible causes were tested and ruled out along the way (asar packing needing `asarUnpack`, `ELECTRON_RUN_AS_NODE` leaking into the grandchild process, portable-mode's fresh-extraction-per-launch) before this was isolated — none of those were the actual cause, but each was verified rather than assumed.
- **One more real bug, caught by the tutor itself during verification:** `python.js`'s rewrite (done under time pressure during the Docker removal) dropped output accumulation entirely — the browser's live stream still worked (a separate code path), but every run record was being written as "(no output)" regardless of what the program actually printed. Found when the tutor, asked what a run printed, correctly reported the record said nothing — which was true of the record, not of the actual run. Fixed and reverified with both a success case and an error/traceback case.

Every item above was verified against the actual packaged, installed `.exe` — not dev mode, not assumed from the source — before being called done.

Revision 19 (2026-09-25): full repo review, every tracked file checked, not just the ones someone happened to complain about. Found and fixed:
- The `.bat` launchers were deleted from disk earlier but never `git rm`'d — still tracked. Removed properly, and the README rewritten to describe the app as what it now is (a real installed Windows program — open it, close it, nothing else to run or stop), replacing leftover instructions for the batch-file era.
- The installer's own NSIS defaults were creating a desktop shortcut nobody asked for — the exact same mistake as before, just via a different mechanism this time. Disabled explicitly (`createDesktopShortcut: false`).
- Two stale comments (`server/src/index.js`, `frontend/src/OutputCanvas.jsx`) still described the run channel as talking to Piston. Neither is true anymore; both corrected.
- Test scratch content had leaked into the repo's shipped example workspace: `workspace/main.zzqx` (an unsupported-extension test file) and `workspace/page.html` (test copy about the app's own UI, not example content for a learner). Removed.
- Unused default Vite scaffold assets removed (`frontend/README.md`, `react.svg`, `vite.svg`, `hero.png`, `icons.svg`) — none were referenced anywhere in the app.
- **Real bug, not just cleanup:** the Monaco editor's `theme` prop was hardcoded to `"light"`, completely independent of the app's own theme setting. Switching to dark mode changed the page background but left the code editor itself stuck light — this was never caught because earlier dark-mode testing only checked `document.body`'s background color, never the editor specifically. Fixed and reverified: dark mode now shows Monaco's actual `rgb(30, 30, 30)` background, not the light one.
- The favicon is still Vite's own default logo, not a real app icon — flagged, not fixed, since it depends on the app's name being settled first (name suggestions were given earlier and never chosen from).
