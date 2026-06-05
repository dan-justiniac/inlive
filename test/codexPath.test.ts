import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { resolveCodexPath } from "../src/codexPath";

function executable(dir: string, name = "codex") {
  const path = join(dir, name);
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
  return path;
}

describe("resolveCodexPath", () => {
  test("uses INLIVE_CODEX_PATH when it points to an executable file", () => {
    const dir = mkdtempSync(join(tmpdir(), "inlive-codex-"));
    try {
      const codex = executable(dir, "custom-codex");
      expect(resolveCodexPath({ env: { INLIVE_CODEX_PATH: codex, PATH: "" }, candidates: [] })).toBe(codex);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("uses the first executable system candidate before PATH lookup", () => {
    const dir = mkdtempSync(join(tmpdir(), "inlive-codex-"));
    try {
      const codex = executable(dir);
      expect(resolveCodexPath({ env: { PATH: "" }, candidates: [codex] })).toBe(codex);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("finds codex on PATH after explicit candidates fail", () => {
    const dir = mkdtempSync(join(tmpdir(), "inlive-codex-"));
    try {
      const bin = join(dir, "bin");
      mkdirSync(bin);
      const codex = executable(bin);
      expect(resolveCodexPath({ env: { PATH: bin }, candidates: [join(dir, "missing")] })).toBe(codex);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns null when no executable codex can be found", () => {
    const dir = mkdtempSync(join(tmpdir(), "inlive-codex-"));
    try {
      expect(resolveCodexPath({ env: { PATH: dir }, candidates: [join(dir, "missing")] })).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
