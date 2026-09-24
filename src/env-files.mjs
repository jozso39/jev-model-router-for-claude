import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where the credential lives. `~/.claude/jev-router.env` sits next to Claude Code's own
 * configuration, which is where people look for it. Earlier locations still load so an
 * existing setup keeps working; the launch directory's `.env` wins over all of them, and
 * variables already in the environment win over every file.
 */
export const PRIMARY_ENV_FILE = join(homedir(), ".claude", "jev-router.env");

export const ENV_FILES = [
  join(process.cwd(), ".env"),
  PRIMARY_ENV_FILE,
  join(homedir(), ".jev-router.env"),
  join(homedir(), ".jev-claude.env"),
];

/** Loads every env file in precedence order; missing or unreadable files are skipped. */
export function loadEnvFiles(files = ENV_FILES) {
  for (const file of files) {
    try {
      process.loadEnvFile(file);
    } catch {
      // Missing or unreadable; the key may still come from the real environment.
    }
  }
}
