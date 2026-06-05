import { describe, expect, test } from "vitest";
import { contextMenuScopes } from "../src/contextScopes";

describe("contextMenuScopes", () => {
  test("registers one practical action per Live menu surface", () => {
    expect(contextMenuScopes).toEqual([
      "AudioClip",
      "MidiClip",
      "AudioTrack",
      "MidiTrack",
      "ClipSlot",
      "Scene",
      "Simpler",
      "Sample",
      "DrumRack",
      "ClipSlotSelection",
      "AudioTrack.ArrangementSelection",
      "MidiTrack.ArrangementSelection",
    ]);
  });

  test("covers every documented context menu scope used by InLive", () => {
    expect(contextMenuScopes).toHaveLength(12);
  });
});
