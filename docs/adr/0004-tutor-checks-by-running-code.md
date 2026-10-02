# 4. The tutor checks claims by running the learner's code privately

- Status: accepted
- Date: 2026-09-27 (Python); 2026-09-28 (every built-in language); 2026-10-01 (restricted runs)

## Context and problem

Language models state syntax rules confidently and sometimes wrongly, and they tend to agree with a learner who pushes back. In live sessions the tutor said JSON allows trailing commas, then agreed a correct comma was wrong. A logic suite of 25 syntax questions, each with a learner pushing back with the opposite of the truth, measured it: right first time in 43 of 50 conversations, held the truth in 43.

## Options considered

1. **Better instructions only** — cheap; the suite showed it isn't enough.
2. **A fixed table of syntax rules** — reliable for the rules in it; can't cover every language and every question.
3. **Let the tutor run the learner's own file privately** — the answer comes from the language itself.

## Decision

Option 3. The tutor has one tool: run the learner's current file, exactly as it is, with inputs it chooses. It can't run code it writes itself. It's told to run before ruling on whether something is allowed and whenever the learner disputes an answer, to report only what the run showed, and to keep a run-backed answer under pressure. With it, the logic suite went to 50 of 50 on both measures, and to 72 of 74 on a harder set.

These runs happen without the learner pressing Run, so each one is a separate process under Node's permission system: it can read only its own temporary folder and the app's code, write only its folder, start no other programs, use no network, and sees no environment variables.

## Consequences

- Works only with providers and models that support tool calls; others answer from the model alone.
- The tutor can't see earlier replies' runs, so it has to run again instead of remembering — written into its instructions.
- A run without an error doesn't always mean a line does what the learner thinks (Ruby reads `elif` as a method call that silently does nothing), so the run result says outright whether it ended cleanly.
- C/C++ aren't covered ([ADR 3](0003-c-compiler-on-first-use.md)).
