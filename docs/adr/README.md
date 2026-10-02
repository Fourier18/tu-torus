# Architecture decision records

One file per decision that shaped Tu-Torus: the situation, the options considered, what was decided and what followed from it. Format based on [MADR](https://adr.github.io/madr/). The story around them is in [HISTORY.md](../HISTORY.md).

| # | Decision | Status |
|---|---|---|
| [1](0001-run-languages-inside-the-app.md) | Run languages inside the app, not in Docker | Accepted |
| [2](0002-bring-your-own-ai-provider.md) | Bring your own AI provider; no Claude sign-in | Accepted |
| [3](0003-c-compiler-on-first-use.md) | Download the C/C++ compiler on first use | Accepted |
| [4](0004-tutor-checks-by-running-code.md) | The tutor checks claims by running the learner's code privately | Accepted |
| [5](0005-learner-data-outside-the-install-folder.md) | Keep the learner's files outside the install folder | Accepted |
| [6](0006-api-key-encrypted-with-the-windows-account.md) | Encrypt the API key with the Windows account | Accepted |
