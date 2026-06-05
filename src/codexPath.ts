import { accessSync, constants, statSync } from "node:fs";
import { join } from "node:path";

export interface CodexPathOptions {
  env?: NodeJS.ProcessEnv;
  candidates?: readonly string[];
}

const defaultCandidates = ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"] as const;

function isExecutableFile(path: string) {
  try {
    return statSync(path).isFile() && (accessSync(path, constants.X_OK), true);
  } catch {
    return false;
  }
}

export function resolveCodexPath(options: CodexPathOptions = {}) {
  const env = options.env ?? process.env;
  const candidates = options.candidates ?? defaultCandidates;
  const explicit = env.INLIVE_CODEX_PATH;

  if (explicit) return isExecutableFile(explicit) ? explicit : null;

  for (const candidate of candidates) {
    if (isExecutableFile(candidate)) return candidate;
  }

  for (const dir of (env.PATH ?? "").split(":").filter(Boolean)) {
    const candidate = join(dir, "codex");
    if (isExecutableFile(candidate)) return candidate;
  }

  return null;
}
