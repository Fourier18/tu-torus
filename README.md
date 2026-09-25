# Tu-Torus

A live coding tutor: write code, run it, and get coached on what happened — without the tutor ever writing or editing your code for you. Three panels — an editor, an output panel that shows only what your program actually prints (never a raw terminal), and a chat panel where the tutor reads your code and your last run and talks you through it.

Runs any language your machine has a compiler or interpreter for, plus Python out of the box with nothing to install — no Docker, no separate sandbox, no signup. The tutor itself runs on Claude by default, or your own local or cloud model if you connect one in Settings.

## To install it

Run `Tu-Torus Setup 1.0.0.exe`, in the `dist` folder. A real Windows installer — puts it in your Start Menu like any other program.

## Requirements

Nothing, to run Python. Other languages need their own compiler/interpreter on your machine (e.g. `rustc` for Rust) — the app tells you plainly if one isn't found.
