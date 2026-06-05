import { describe, expect, test } from "vitest";
import {
  buildCodexAppServerLaunch,
  buildCodexAppServerEnv,
  buildCodexLaunchConfigHash,
  inLiveBinDir,
} from "../src/codexLaunchContext";
import { extensionStatusPath } from "../src/extensionStatus";

describe("Codex app-server launch context", () => {
  test("prepends the InLive bin directory to PATH exactly once", () => {
    expect(buildCodexAppServerEnv({ PATH: "/usr/bin" }).PATH).toBe(`${inLiveBinDir}:/usr/bin`);
    expect(buildCodexAppServerEnv({ PATH: `${inLiveBinDir}:/usr/bin` }).PATH).toBe(`${inLiveBinDir}:/usr/bin`);
  });

  test("preserves inherited environment and adds the JS runner status path", () => {
    expect(buildCodexAppServerEnv({ PATH: "/usr/bin", KEEP: "yes" })).toMatchObject({
      KEEP: "yes",
      PATH: `${inLiveBinDir}:/usr/bin`,
      INLIVE_JS_RUNNER_STATUS: extensionStatusPath,
    });
  });

  test("builds app-server args with explicit shell environment inheritance", () => {
    expect(buildCodexAppServerLaunch({ PATH: "/usr/bin" })).toMatchObject({
      args: [
        "app-server",
        "--listen",
        "stdio://",
        "-c",
        "shell_environment_policy.inherit=all",
        "-c",
        "shell_environment_policy.include_only=[\"PATH\",\"HOME\",\"USER\",\"TMPDIR\",\"SHELL\"]",
      ],
      env: {
        PATH: `${inLiveBinDir}:/usr/bin`,
        INLIVE_JS_RUNNER_STATUS: extensionStatusPath,
      },
    });
  });

  test("builds a stable launch config hash from Codex path, cwd, bin dir, prompt, and env policy", () => {
    const first = buildCodexLaunchConfigHash({ codexPath: "/bin/codex", cwd: "/Users/dan/Documents/InLive" });
    const second = buildCodexLaunchConfigHash({ codexPath: "/bin/codex", cwd: "/Users/dan/Documents/InLive" });
    const changed = buildCodexLaunchConfigHash({ codexPath: "/bin/other-codex", cwd: "/Users/dan/Documents/InLive" });

    expect(first).toBe(second);
    expect(first).toBe("af86bca354a0af0985c70ef71f4729c89781bec7514a63d36c586afc0c225417");
    expect(changed).not.toBe(first);
  });
});
