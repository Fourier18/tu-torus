# 6. Encrypt the API key with the Windows account

- Status: accepted
- Date: 2026-10-01

## Context and problem

The learner's API key was saved as plain text in `settings.json`. Anyone or anything that could read the file — a shared computer, a backup, a zipped folder sent for help — could use the key, and the learner's provider account would pay.

## Options considered

1. **Leave it as plain text** — common in small tools; the risk above stays.
2. **Ask for the key every session** — safe; tiresome for a learner, and lost on every restart.
3. **Encrypt it with the operating system's per-user protection** — Electron's safeStorage, which on Windows uses the account's own data protection (DPAPI).

## Decision

Option 3, from 1.7.0. safeStorage exists only in Electron's main process and the app's server is a separate process, so the server asks the main process over the channel it already has to encrypt or decrypt. A key saved as plain text by an earlier version is encrypted the first time 1.7.0 starts. The page never receives the key: it learns only whether one is saved and its last four characters.

## Consequences

- A copy of the settings file on another computer or Windows account can't be read; the app says so and asks for the key again.
- Software already running under the learner's own account could still decrypt it, as with any app that remembers a password; the README suggests a spending limit at the provider.
- Development runs without Electron keep the key as before, and the test suites take it from TUTOR_API_KEY when the installed app's copy is encrypted.
