# 3. Download the C/C++ compiler on first use

- Status: accepted
- Date: 2026-09-26

## Context and problem

Beginners often start with C or C++, and installing a compiler on Windows (MSYS2, Visual Studio, PATH settings) is one of the most common places they give up. A compiler built for WebAssembly (Clang/LLVM from the YoWASP project) runs on the app's own Node, but it's about 27 MB — more than any other part of the app.

## Options considered

1. **Ask learners to install a compiler** — what most tools do; the setup this app exists to avoid.
2. **Bundle the compiler in the installer** — works offline from the start; every learner downloads it, whether they use C or not.
3. **Download it the first time a .c or .cpp file is run** — a one-time wait, then offline.

## Decision

Option 3. On the first C/C++ run the app downloads the YoWASP Clang package from the npm registry, checks it against npm's published SHA-512 fingerprint, unpacks it into a temporary folder and moves it into place, so an interrupted download never leaves a half-installed compiler.

## Consequences

- The installer stays small, and C/C++ need an internet connection only once.
- A failed download says why in plain words (offline, refused, a stalled connection is given up after 60 seconds) and mentions that a school or office network may block it.
- The tutor's private runs don't cover C/C++, because a private check mustn't start a 27 MB download.
- The compiler's license (Apache 2.0 with LLVM exceptions) is listed in the notices, as software the app downloads rather than ships.
