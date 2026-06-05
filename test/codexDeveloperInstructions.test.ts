import { describe, expect, test } from "vitest";
import {
  buildInLiveDeveloperInstructions,
  inLiveDeveloperInstructionsHash,
  inLiveDeveloperInstructionsVersion,
} from "../src/codexDeveloperInstructions";

const expected = `You are running inside InLive, an Ableton Live extension.

You can execute JavaScript in the Live ExtensionHost with:

  js-in-live -e "return Boolean(live.ui)"
  js-in-live ./script.js --arg count=2

The script runs in the ExtensionHost process. It receives:
- live: initialized Ableton Extensions SDK context
- sdk: @ableton-extensions/sdk module
- console: captured output returned to the CLI
- args: values passed with --arg name=value
- require: ExtensionHost-side CommonJS require

Prefer js-in-live for Live SDK inspection and actions. Do not assume browser or shell state reflects Live state unless verified through js-in-live.`;

describe("InLive developer instructions", () => {
  test("returns the exact Codex app-server developer prompt", () => {
    const prompt = buildInLiveDeveloperInstructions();

    expect(prompt).toContain(expected);
    expect(prompt).toContain("# Repo Skill: live-sdk");
    expect(prompt).toContain("Start at `live.application.song`.");
    expect(prompt).toContain("Fail loudly when the intended Live operation cannot be proven.");
  });

  test("exposes stable version and hash metadata", () => {
    expect(inLiveDeveloperInstructionsVersion).toBe(2);
    expect(inLiveDeveloperInstructionsHash).toBe("e40af4ec157a9c150132f1f3a5b41c4f9e7b75f7da2d2c41370d3940cf145b3e");
  });
});
