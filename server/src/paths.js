// Fixed by location, not by process.cwd() — cwd depends on how/where the
// server was launched, which should never change what "the project" means.
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", ".."); // coding-tutor/

export const WORKSPACE_DIR = path.join(REPO_ROOT, "workspace"); // the user's actual project files — all the tutor's Read/Glob/Grep can see
export const TUTOR_DIR = path.join(WORKSPACE_DIR, ".tutor"); // run records, settings, usage log, tmp — lives inside the workspace so the tutor's Read/Glob can reach run records directly
