# 5. Keep the learner's files outside the install folder

- Status: accepted
- Date: 2026-09-26

## Context and problem

Version 1.0.0 kept the learner's code, settings and run records in a `workspace` folder inside the install folder. Installing an update replaces that folder, so updating wiped everything the learner had written.

## Options considered

1. **Back up and restore around each update** — fragile, and invisible to the learner until it fails.
2. **The per-user data folder** — `%APPDATA%\tu-torus`, which Windows keeps per user and installers leave alone.

## Decision

Option 2, from 1.0.1. The server gets the data folder from Electron and keeps everything there: the files in `workspace`, settings and run records in `workspace\.tutor`, and the downloaded C/C++ compiler in `tools`. The 1.0.1 installer copied 1.0.0's files across before removing the old version.

## Consequences

- Updates and uninstalling leave the learner's files in place (the README says where they are).
- Release installs have been checked file by file, before and after: no changes so far.
- Settings are written atomically (a temporary file, then a rename), and a settings file that can't be read is copied aside rather than overwritten.
