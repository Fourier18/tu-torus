# 7. Check each tutor answer against its tool use before showing it

- Status: accepted
- Date: 2026-10-02

## Context and problem

The tutor's private run ([ADR 4](0004-tutor-checks-by-running-code.md)) only helps if its answers are honest about it. A mechanical check of the tutor's claims against the app's record of tool calls found that in a held-out run of 116 conversations (real beginner mistakes, never used for tuning), 27 had the tutor say "I ran your code" when it hadn't run anything. The model grading the suites passed all 27, because it never sees whether the tool was called.

An experiment on 12 pushback turns found the main cause. When a request carrying the run tool failed, most often on a rate limit, the app answered with a plain request instead: no tool, but the instructions still described it. All 12 such replies claimed a run. With the tool actually sent, 3 of 12 still claimed one without calling it. With a note saying no run was possible for this reply, 0 of 12 did.

Two more kinds of unbacked claim turned up: "I changed the line and ran it again" (the tool runs only the learner's file as it is), and statements about what the code does, such as "your code will crash with a syntax error" or "that comma isn't allowed", made with no run attached and none made. Both were wrong in the cases found.

## Options considered

1. **Stronger instructions only.** The instructions already said all of this, and the model still did it.
2. **Run the learner's file before every answer.** This grounds every reply, but adds a run and a model round to every message, including ones that aren't about the code.
3. **Check each finished answer and act only when it needs to.** The answer arrives whole before it's shown (tool-using requests aren't streamed), so the app can look at it first.

## Decision

Option 3, plus a fix to the fallback.

- **The tool's instructions travel with the tool.** A request that carries the run tool gets its note; an answer made without the tool gets a note saying it can't run anything this time. A rate limit, a bad key, an account without credit or an outage is reported to the learner instead of answered without the tool.
- **Each finished answer is reviewed** (`answerReview` in `tutor.js`, applied in `chat()` in `openai-compatible.js`):
  - It says it ran the code, but no run happened in this reply → asked again with a tool call required, so a real run backs it. The model picks the inputs.
  - It says what the code does or whether something is allowed, with no run attached and none made → the same.
  - It claims a run of changed code → asked again once, with a reminder that the tool runs only their file.
  - It says a run printed something none of this reply's runs printed (it ran `range(1, 5)` and reported `range(1, 6)`'s output) → asked again once, with a note naming the mismatch.
  - If the second try still fails, the answer is made without the tool. Then it can't claim a run at all.

On 25 held-out pushback turns, the unguarded tutor claimed a run that didn't happen 6 times; the guarded one never did, and Mistral accepted the required run every time.

The same release also takes two habits out of the reply as it streams (`reply-tidy.js`): a "You're right —" opener when the learner isn't right, which was in 35 of 116 replies to a wrong pushback, and closing nudges like "Want to try it?".

## Consequences

- Answers that need a recheck take one or two extra model requests and a private run. That happens only when an answer makes a claim nothing backs.
- The checks are patterns over sentences. A claim worded in a way they don't match gets through, and `server/test/claim-check.mjs` measures what's left after each suite run. It's a separate copy of the patterns, so its misses aren't always the guard's.
- A provider that supports tools but rejects a required tool call makes such answers fall back to an answer without the tool. That answer is honest but has no run behind it.
- The opener is dropped even when the learner is right. The correction itself still says what was wrong.
