# 1. Run languages inside the app, not in Docker

- Status: accepted
- Date: 2026-09-24

## Context and problem

The tutor has to see what the learner's program actually did, so the app has to run it. The first build used Piston, a code-execution service that needs Docker. Installing Docker (and keeping it running) is a big ask for someone in their first week of programming; even on the development machine it needed a WSL fix and a Docker Desktop restart before it worked.

## Options considered

1. **Piston in Docker** — many languages, strong isolation; a heavy install and a running service.
2. **Languages installed on the learner's computer** — no extra layer; every learner sets up every language themselves.
3. **Ship the languages inside the app** — an Electron app with Python as Pyodide, and other languages compiled to WebAssembly, run on the Node that Electron already contains.

## Decision

Option 3. Python runs on Pyodide; JavaScript and TypeScript on Electron's own Node; Ruby, PHP, Perl, Lua and BASIC as WebAssembly builds or JavaScript compilers. Languages that need their own toolchains (Go, Java, C#, Rust) run when installed, and the app links to them. C and C++ are covered by [ADR 3](0003-c-compiler-on-first-use.md).

## Consequences

- Nothing to install for the built-in languages; the installer is about 140 MB.
- Each engine has quirks to work around (typed input, error formats, a parser that refused some valid BASIC), found and fixed through testing.
- The learner's own Run has the access any program they start has, like running it in a terminal. The tutor's private runs are restricted separately ([ADR 4](0004-tutor-checks-by-running-code.md)).
- Every bundled engine's license has to be listed and shipped (THIRD_PARTY_NOTICES.txt).
