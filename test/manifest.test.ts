import { describe, expect, test } from "vitest";
import manifest from "../manifest.json";
import packageJson from "../package.json";

describe("extension entry", () => {
  test("uses a CommonJS entry because ExtensionHost loads extensions with require", () => {
    expect(packageJson.type).toBe("module");
    expect(manifest.entry).toBe("dist/extension.cjs");
    expect(packageJson.main).toBe(manifest.entry);
  });
});
