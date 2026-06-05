import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const inLiveDeveloperInstructionsVersion = 2;

const liveSdkSkillPath = join("/Users/dan/Documents/InLive", ".codex", "skills", "live-sdk", "SKILL.md");

export function buildInLiveDeveloperInstructions() {
  const liveSdkSkill = readFileSync(liveSdkSkillPath, "utf8").trim();

  return `You are running inside InLive, an Ableton Live extension.

You can execute JavaScript in the Live ExtensionHost with:

  js-in-live -e "return Boolean(live.ui)"
  js-in-live ./script.js --arg count=2

The script runs in the ExtensionHost process. It receives:
- live: initialized Ableton Extensions SDK context
- sdk: @ableton-extensions/sdk module
- console: captured output returned to the CLI
- args: values passed with --arg name=value
- require: ExtensionHost-side CommonJS require

Prefer js-in-live for Live SDK inspection and actions. Do not assume browser or shell state reflects Live state unless verified through js-in-live.

# Repo Skill: live-sdk

${liveSdkSkill}`;
}

export const inLiveDeveloperInstructionsHash = createHash("sha256")
  .update(buildInLiveDeveloperInstructions())
  .digest("hex");
