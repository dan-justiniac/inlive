import type { ContextMenuScope } from "@ableton-extensions/sdk";

export const contextMenuScopes = [
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
] as const satisfies readonly ContextMenuScope<"1.0.0">[];
