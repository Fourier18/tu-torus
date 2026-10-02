# How Tu-Torus came about

Tu-Torus is a coding tutor for beginners: an editor, an output panel and a tutor that sees the learner's code and what happened when they ran it. This is the short history of how it got its shape. The decisions that shaped it are written up one by one in [docs/adr](adr/).

## The idea (September 2026)

The starting point was a tutor that coaches rather than writes the code: it should see exactly what the learner sees — their file, what it printed, the error — and talk them through it, the way a patient person sitting beside them would. Three panels, any language, nothing to set up.

## First builds (24–25 September)

The first version ran code through Piston in Docker. It worked, but asking a beginner to install Docker defeated the purpose, so within the first day the app moved to Electron with Python running inside it (Pyodide), and Docker went away ([ADR 1](adr/0001-run-languages-inside-the-app.md)).

Early development builds connected the tutor through a Claude sign-in. Anthropic's terms don't allow third-party apps to offer claude.ai login without approval, which wasn't known when those builds were made; as soon as it was, the sign-in was removed, before the first public release. Since then the tutor uses whichever AI provider the learner chooses, with their own API key ([ADR 2](adr/0002-bring-your-own-ai-provider.md)).

Version 1.0.0, the first public release, came out on 25 September.

## Phase one (26–27 September)

The next two days were a run of small releases (1.0.1 to 1.0.15), each driven by testing the installed app:

- the learner's files moved out of the install folder, after a reinstall wiped them ([ADR 5](adr/0005-learner-data-outside-the-install-folder.md))
- a security pass: the app's server answers only the app itself
- the tutor's notes about how the learner is doing, which they can read, edit and pin
- six more languages built in, compiled to WebAssembly so they need no installs: TypeScript, Ruby, PHP, Perl, Lua and BASIC
- C and C++, with a compiler that sets itself up on first use ([ADR 3](adr/0003-c-compiler-on-first-use.md))
- the editor bundled with the app, themes, and Settings explanations
- the discovery that the tutor had never actually received the learner's runs, and the fix

Phase one was declared done at 1.1.0 on 27 September, about 72 hours after the first commit.

## Testing-driven rounds (27 September – 1 October)

From there the work was driven by testing, first by hand and then with suites that check the tutor against the truth:

- **1.2–1.4:** Stop and time limits that can't be fooled, a file menu, JSON checking on Run, and plainer answers to big-picture questions.
- **1.5:** a logic suite of syntax-rule questions, where each learner pushes back with the opposite of the truth. The tutor was right first time in 43 of 50 conversations and held the truth in 43; giving it a private way to run the learner's file before answering took both to 50 of 50 ([ADR 4](adr/0004-tutor-checks-by-running-code.md)).
- **1.6:** a language-competency suite, where the tutor's own examples are run in every language. It found a real BASIC parsing bug and JavaScript's missing `prompt()`. Then the tutor's private runs were locked down to their own temporary folder, with no network and no other programs.
- **1.7:** release readiness: license notices for everything the app ships, the API key encrypted with the Windows account, safer saving, an update note, accessibility fixes, and checks on unusual install paths and offline use.

The current testing plan, the release gate and the suites live in `scripts/` and `server/test/`.
