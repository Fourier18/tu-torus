# Tu-Torus

A live coding tutor: write code, run it, and get coached on what happened — without the tutor ever writing or editing your code for you. Three panels — an editor, an output panel that shows only what your program actually prints (never a raw terminal), and a chat panel where the tutor sees your code and your last run and talks you through it.

Runs any language your machine has a compiler or interpreter for, plus Python out of the box with nothing to install — no Docker, no separate sandbox, no signup. The tutor talks to whatever model you connect in Settings — no built-in subscription, so it works with a free API key from several providers.

## To install it

Download `Tu-Torus Setup 1.0.1.exe` from [the latest release](https://github.com/Fourier18/tu-torus/releases/latest) and run it.

## Requirements

Nothing, to run Python. Other languages need their own compiler/interpreter on your machine (e.g. `rustc` for Rust) — the app tells you plainly if one isn't found.

## Connecting a tutor model

Open Settings (the gear icon, top right). You'll see two options: **Add your own** (default) to enter any OpenAI-compatible endpoint manually, or **Browse providers** to pick from a list of pre-configured ones. Picking a preset fills in its base URL; base URL and model name stay editable either way. API keys are saved only on this machine, never sent anywhere but the provider you chose.

Model names aren't pre-filled. Provider model lineups change too often to bake a specific one into this app — each preset instead links to that provider's own live, current model list, so you always copy a model ID that actually exists right now instead of one we guessed and left to go stale.

### Preset providers

- **Mistral** — [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys). Requires activating a plan before use, even free: go to Billing/Subscription and choose "Experiment for free" (phone verification, no card).
- **Google Gemini** — [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
- **OpenRouter** — [openrouter.ai/keys](https://openrouter.ai/keys). Covers most other models behind one key.
- **Groq** — [console.groq.com/keys](https://console.groq.com/keys).
- **DeepSeek** — [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys).
- **Together AI** — [api.together.xyz/settings/keys](https://api.together.xyz/settings/keys).
- **Perplexity** — [www.perplexity.ai/settings/api](https://www.perplexity.ai/settings/api).
- **Ollama** (local) — runs on `http://localhost:11434/v1`, no API key needed. [ollama.ai](https://ollama.ai).
- **LM Studio** (local) — runs on `http://localhost:1234/v1`, no API key needed. [lmstudio.ai](https://lmstudio.ai).

Free tiers from Mistral and Gemini may use your prompts for training data — a paid key generally avoids this.

## Building from source

Only needed if you're modifying the app, not to install it.

```
npm install
npm run setup
npm run package
```

Builds `dist/Tu-Torus Setup 1.0.1.exe`.
