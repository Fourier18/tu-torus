// Single source of truth for language handling — both runner.js (what runs
// the code) and the frontend (syntax highlighting label, browser-native
// rendering flag) read from this one file, via GET /api/languages for the
// frontend. Nothing hardcodes a second copy of this table anywhere.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LANGUAGES = JSON.parse(readFileSync(path.join(__dirname, "languages.json"), "utf-8"));
