# Tu-Torus

A live coding tutor: write code, run it, and get coached on what happened. Three panels — an editor, an output panel that shows what your program prints, and a chat panel where the tutor sees your code and your last run and talks you through it.

Nine languages come built in and run the moment you press Run: Python, JavaScript, TypeScript (type-checked), Ruby, PHP, Perl, Lua, BASIC, and HTML/CSS web pages. Programs that ask for input wait for you to type, just like in a terminal.

**C and C++ included.** The compiler sets itself up the first time you press Run on a `.c` or `.cpp` file: a one-time 27 MB download, then it works offline. No MSYS2, no PATH settings, no afternoon lost to installing a compiler.

Go, Java, C#, Rust and others run too once their official tools are installed, and Run links you to them. The tutor talks to whatever model you connect in Settings — no built-in subscription, so it works with a free API key from several providers.

## Working in it

- **Files:** the ▾ beside the file name lists your saved files and has **New file**: pick a language, type a name, and the ending is added for you. Your files are kept in `%APPDATA%\tu-torus\workspace`.
- **Run and Stop:** Run is at the bottom right of the output panel. While a program runs it becomes Stop (Ctrl+C in the input box does the same). A program that prints endlessly is stopped after 200,000 characters of output; one that loops silently is stopped after 15 seconds (in Python, use Stop).
- **JSON files:** Run checks them and shows "Valid JSON." or the first mistake with its line and column.
- **BASIC** is QBasic-style and text only for now: graphics commands such as `SCREEN` and `PSET` aren't available.

## To install it

Download `Tu-Torus.Setup.1.4.1.exe` from [the latest release](https://github.com/Fourier18/tu-torus/releases/latest).

## Requirements

Windows. Everything for the built-in languages ships with the app, and C/C++ need only an internet connection the first time. Go, Java, C# and Rust need their own tools on your machine; the first time you run one without them, the output panel says which and links to the download.

## Connecting a tutor model

Open Settings (the gear icon, top right). You'll see two options: **Add your own** (default) to enter any OpenAI-compatible endpoint manually, or **Browse providers** to pick from a list of pre-configured ones. Picking a preset fills in its base URL; base URL and model name stay editable either way. API keys are saved only on this machine, never sent anywhere but the provider you chose.

Model names aren't pre-filled. Provider model lineups change too often to bake a specific one into this app — each preset links to that provider's current model list to copy one from.

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

## Other settings

- **Theme**: Light, Dark, Forest Green, Azure Night, Desert Sunset, Arctic Dawn or Plum Midnight. The editor changes with the rest of the app.
- **Editor suggestions**: autocomplete, hints and error underlines as you type. Off by default. Fullest for JavaScript, TypeScript, HTML and CSS; other languages get suggestions from words already in the file.
- **What the tutor remembers about you**: short notes the tutor keeps on how you're doing, stored on this computer. You can edit them, clear them, or start a line with `*` to pin it so the tutor won't change it.

Rest the mouse on a setting's name in Settings for a short explanation.

## Building from source

Only needed if you're modifying the app, not to install it.

```
npm install
npm run setup
npm run package
```

Builds `dist/Tu-Torus Setup 1.4.1.exe`.
