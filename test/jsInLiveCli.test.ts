import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { buildRunnerRequest, formatRunnerResponse, readRunnerConfig } from "../src/jsInLiveCli";

let cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths) rmSync(path, { recursive: true, force: true });
  cleanupPaths = [];
});

describe("js-in-live CLI", () => {
  test("builds a runner request from an inline snippet", () => {
    expect(buildRunnerRequest(["-e", "return 7;", "--arg", "name=dan"])).toEqual({
      code: "return 7;",
      args: { name: "dan" },
    });
  });

  test("builds a runner request from a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "inlive-cli-"));
    cleanupPaths.push(dir);
    const file = join(dir, "probe.js");
    writeFileSync(file, "return args.value;");

    expect(buildRunnerRequest([file, "--arg", "value=42"])).toEqual({
      code: "return args.value;",
      filename: file,
      args: { value: 42 },
    });
  });

  test("reads runner URL and token from extension status", () => {
    const dir = mkdtempSync(join(tmpdir(), "inlive-cli-"));
    cleanupPaths.push(dir);
    const statusPath = join(dir, "status.json");
    writeFileSync(statusPath, JSON.stringify({
      jsRunner: { url: "http://127.0.0.1:15176/run", token: "secret" },
    }));

    expect(readRunnerConfig(statusPath)).toEqual({
      url: "http://127.0.0.1:15176/run",
      token: "secret",
    });
  });

  test("prints logs and JSON results", () => {
    expect(formatRunnerResponse({
      ok: true,
      logs: [{ level: "log", text: "hello" }],
      result: { kind: "json", value: { ok: true } },
      durationMs: 3,
    })).toBe("hello\n{\"ok\":true}");
  });

  test("prints errors and exits through an explicit exception path", () => {
    expect(() => formatRunnerResponse({
      ok: false,
      logs: [{ level: "error", text: "bad" }],
      error: { message: "boom", stack: "Error: boom" },
      durationMs: 1,
    })).toThrow("bad\nError: boom");
  });

  test("exposes an extensionless js-in-live package bin", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { bin: Record<string, string> };
    const binPath = pkg.bin["js-in-live"];

    expect(binPath).toBe("bin/js-in-live");
    expect(readFileSync(binPath, "utf8").startsWith("#!/usr/bin/env node")).toBe(true);
    expect(statSync(binPath).mode & 0o111).toBeGreaterThan(0);
  });
});
