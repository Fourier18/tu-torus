# Tu-Torus

A live coding tutor: write code, run it, and get coached on what happened. Three panels — an editor, an output panel that shows what your program prints, and a chat panel where the tutor sees your code and your last run and talks you through it. When a question turns on what the code actually does — is this comma allowed, does this print what I think — the tutor runs your file privately to check before it answers. Those private runs are kept to a temporary folder of their own, with no network and no other programs.

Nine languages come built in and run the moment you press Run: Python, JavaScript, TypeScript (type-checked), Ruby, PHP, Perl, Lua, BASIC, and HTML/CSS web pages. Programs that ask for input wait for you to type, just like in a terminal. While a program runs, Run becomes Stop (Ctrl+C in the input box does the same). A program that prints endlessly is stopped after 200,000 characters of output, and one that runs 15 seconds without finishing is stopped too (time spent waiting for you to type isn't counted).

BASIC is QBasic-style, with text output. Pressing Run on a JSON file checks it and shows "Valid JSON." or the first mistake with its line and column.

**C and C++ included.** The compiler sets itself up the first time you press Run on a `.c` or `.cpp` file: a one-time 27 MB download, then it works offline. No MSYS2, no PATH settings, no afternoon lost to installing a compiler.

Go, Java, C#, Rust and others run too once their official tools are installed, and Run links you to them. The tutor talks to whatever model you connect in Settings — no built-in subscription, so it works with a free API key from several providers.

## To install it

Download `Tu-Torus.Setup.1.7.0.exe` from [the latest release](https://github.com/Fourier18/tu-torus/releases/latest).

Windows may show "Windows protected your PC" the first time you run the installer. Choose **More info**, then **Run anyway**.

Your files are kept in `%APPDATA%\tu-torus\workspace` and stay there through updates, and if you uninstall. The ▾ beside the file name opens them and starts new ones in any language.

When a newer version is out, a note at the top of the app links to it; installing it keeps your files and settings. Settings → "Check for new versions" turns the note off.

## Requirements

Windows. Everything for the built-in languages ships with the app, and C/C++ need only an internet connection the first time. Go, Java, C# and Rust need their own tools on your machine; the first time you run one without them, the output panel says which and links to the download.

## Connecting a tutor model

Open Settings (the gear icon, top right). You'll see two options: **Add your own** (default) to enter any OpenAI-compatible endpoint manually, or **Browse providers** to pick from a list of pre-configured ones. Picking a preset fills in its base URL; base URL and model name stay editable either way. Your API key is saved on this computer, encrypted with your Windows account, and sent only to the provider you chose. Most providers let you set a spending limit on your account, which caps what a key can cost.

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
- **Check for new versions**: once a day, asks GitHub whether a newer Tu-Torus is out. On by default.

Rest the mouse on a setting's name in Settings for a short explanation.

## Privacy

When the tutor answers, Tu-Torus sends the AI provider you chose your question, the open file's code, the output of your last run, the last few chat messages, and the tutor's notes about you. When the tutor tries your code privately to check an answer, that result goes too. To keep its notes current, it also sends the last few exchanges and the lines you newly wrote. That provider's own terms and privacy policy apply to what it receives.

Everything else stays on this computer: your files, settings, run history and the tutor's notes. The API key is saved encrypted with your Windows account.

Tu-Torus makes two other connections: the update check asks GitHub once a day whether a newer version is out, and the first C or C++ run downloads the compiler from the npm registry.

You need your own account with an AI provider, and its terms apply to you, including any minimum age.

## Reporting a problem

Settings → About → **Report a problem** opens a form on GitHub. **Copy details for a bug report**, just above it, copies what the form asks for: the version, Windows version, and provider and model, without your API key or code.

## Building from source

Only needed if you're modifying the app, not to install it.

```
npm install
npm run setup
npm run package
```

Builds `dist/Tu-Torus Setup 1.7.0.exe`.

## License

Tu-Torus © 2026 Joshua. You may download, install and use the published releases; the terms are in [LICENSE](LICENSE). The language engines and other components inside it are under their own licenses, listed in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) and in Settings → About → Licenses.
