import { createHash } from "node:crypto";
import { inLiveDeveloperInstructionsHash } from "./codexDeveloperInstructions";
import { extensionStatusPath } from "./extensionStatus";

export const inLiveRepoRoot = "/Users/dan/Documents/InLive";
export const inLiveBinDir = `${inLiveRepoRoot}/bin`;
export const codexShellEnvironmentIncludeOnly = ["PATH", "HOME", "USER", "TMPDIR", "SHELL"] as const;
export const codexShellEnvironmentIncludeOnlyConfig = `shell_environment_policy.include_only=${JSON.stringify(codexShellEnvironmentIncludeOnly)}`;
export const codexShellEnvironmentPolicyConfig = {
  inherit: "all",
  include_only: [...codexShellEnvironmentIncludeOnly],
} as const;
export const codexAppServerArgs = [
  "app-server",
  "--listen",
  "stdio://",
  "-c",
  "shell_environment_policy.inherit=all",
  "-c",
  codexShellEnvironmentIncludeOnlyConfig,
] as const;

export function buildCodexAppServerEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const path = env.PATH ?? "";
  const parts = path.split(":").filter(Boolean).filter((part) => part !== inLiveBinDir);
  return {
    ...env,
    PATH: [inLiveBinDir, ...parts].join(":"),
    INLIVE_JS_RUNNER_STATUS: extensionStatusPath,
  };
}

export function buildCodexAppServerLaunch(env: NodeJS.ProcessEnv = process.env) {
  return {
    args: [...codexAppServerArgs],
    env: buildCodexAppServerEnv(env),
  };
}

export function buildCodexLaunchConfigHash(options: { codexPath: string; cwd: string }) {
  return createHash("sha256").update(JSON.stringify({
    codexPath: options.codexPath,
    cwd: options.cwd,
    runnerBinDir: inLiveBinDir,
    developerInstructionsHash: inLiveDeveloperInstructionsHash,
    appServerArgs: codexAppServerArgs,
    shellEnvironmentPolicy: codexShellEnvironmentPolicyConfig,
  })).digest("hex");
}
