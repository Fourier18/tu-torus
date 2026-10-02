# 2. Bring your own AI provider; no Claude sign-in

- Status: accepted
- Date: 2026-09-25

## Context and problem

Early development builds connected the tutor through the Claude Agent SDK with a claude.ai sign-in. Anthropic's terms don't allow third-party apps to offer claude.ai login or subscription-based access unless Anthropic has approved them; they require API-key authentication. This wasn't known when those builds were made.

## Options considered

1. **Keep the Claude sign-in** — not permitted.
2. **One built-in provider with the app's own key** — the app would pay for, and be responsible for, every learner's usage.
3. **Any OpenAI-compatible provider with the learner's own key** — Mistral, Gemini, OpenRouter, Groq, DeepSeek, Together, Perplexity, or a local server (Ollama, LM Studio).

## Decision

Option 3, as soon as the terms were known, before the first public release (1.0.0). The sign-in was removed entirely; no released version has contained it. One generic chat-completions client covers every provider; Settings offers presets that fill in the address, and the learner adds a model name and their key.

## Consequences

- Several providers have free tiers, so the tutor can cost nothing.
- Quality depends on the model the learner picks; small or tool-less models can't use the tutor's private run tool ([ADR 4](0004-tutor-checks-by-running-code.md)).
- The app has to explain provider errors plainly (bad key, unknown model, rate limit, outage, no answer) — tested with a stand-in provider.
- The key is kept on the learner's computer, encrypted ([ADR 6](0006-api-key-encrypted-with-the-windows-account.md)), and sent only to their provider. The provider's own terms and privacy policy apply to what it receives.
