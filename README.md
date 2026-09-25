# Coding Tutor

A live coding tutor: write code, run it, and get coached on what happened — without the tutor ever writing or editing your code for you. Three panels — an editor, an output panel that shows only what your program actually prints (never a raw terminal), and a chat panel where the tutor reads your code and your last run and talks you through it.

Runs any language your machine has a compiler or interpreter for, plus Python out of the box with nothing to install — no Docker, no separate sandbox, no signup. The tutor itself runs on Claude by default, or your own local or cloud model if you connect one in Settings.

## To install it

Run `Coding Tutor Setup 1.0.0.exe` (built from `npm run package`, in the `dist` folder). It's a real Windows installer — it puts the app in your Start Menu like any other program. No desktop icon.

## To use it

Open it from the Start Menu. Close it by closing its window, same as anything else — there's nothing separate to stop.

## Building it from source

```bash
npm run setup     # once, installs both server and frontend dependencies
npm run package   # produces the installer in dist/
```

For active development, without building an installer each time:

```bash
npm run dev
```

## Requirements

- Node 18+ (only for building from source — the installed app needs nothing extra)
- Nothing else required to run Python. Other languages need their own compiler/interpreter installed on your machine (e.g. `rustc` for Rust) — the app tells you plainly if one isn't found.
