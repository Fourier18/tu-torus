// Fixed by location, not by process.cwd() — cwd depends on how/where the
// server was launched, which should never change what "the project" means.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.join(__dirname, "..", ".."); // tu-torus/ — the app's own code (frontend build lives under here)

// Where the learner's files live. The packaged app gets Electron's per-user
// data folder (%APPDATA%\tu-torus) from electron/main.js — installs and
// updates never touch it. It used to be APP_ROOT/workspace, i.e. inside the
// install folder, so every reinstall silently wiped the learner's code,
// settings (API key) and run history. Dev mode (`npm run dev`) sets nothing
// and keeps using the repo's own workspace/.
const DATA_ROOT = process.env.TUTORUS_DATA_DIR || APP_ROOT;
export const WORKSPACE_DIR = path.join(DATA_ROOT, "workspace"); // the user's actual project files
export const TUTOR_DIR = path.join(WORKSPACE_DIR, ".tutor"); // run records, settings, usage log, tmp — lives inside the workspace, next to what it's about

// Created here rather than relying on it to exist — the packaged app never
// ships a workspace/ of its own.
mkdirSync(TUTOR_DIR, { recursive: true });
