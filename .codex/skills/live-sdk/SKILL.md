---
name: live-sdk
description: Use whenever working in the /Users/dan/Documents/InLive repository, the InLive Ableton Live extension, js-in-live, or the Ableton Extensions SDK. Trigger for any task that inspects or changes Ableton Live state from this environment.
---

# Live SDK

## Environment

This repo runs inside InLive, an Ableton Live extension. Prefer ExtensionHost inspection over shell or browser assumptions:

```bash
js-in-live -e "return Boolean(live.ui)"
js-in-live -e "return { live: Boolean(live.ui), cwd: process.cwd() }"
js-in-live ./script.js --arg name=value
```

Scripts receive `live`, `sdk`, `console`, `args`, and ExtensionHost-side `require`.

## Model

This is the Ableton Extensions SDK, not the legacy LOM.

- Start at `live.application.song`.
- Root capabilities include `live.application`, `live.commands`, `live.environment`, `live.resources`, `live.ui`, and `live.withinTransaction`.
- Objects are typed JS instances such as `Song`, `MidiTrack`, `AudioTrack`, `Scene`, `ClipSlot`, `TrackMixer`, and `DeviceParameter`.
- Collections are arrays: `song.tracks`, `song.scenes`, `track.clipSlots`, `track.devices`, `track.mixer.sends`.
- Most SDK API members are prototype properties, not enumerable own keys. Use prototype inspection when exploring.

## Mutation Rules

- Use direct properties for scalar state: `song.tempo = 130`, `track.name`, `track.mute`, `track.solo`, `track.arm`.
- Use parameter methods for mixer/device parameters: `await parameter.getValue()` and `await parameter.setValue(value)`.
- Wrap Live mutations in `live.withinTransaction(...)` when creating, deleting, or grouping changes.
- Treat create/delete operations as async: `await song.createScene(index)`, `await song.deleteScene(scene)`.
- Never leave probe artifacts behind. If exploration creates tracks, scenes, clips, devices, or cue points, delete them before finishing.
- Verify by reading Live state back through `js-in-live`.

## Failure Behavior

Fail loudly when the intended Live operation cannot be proven. Do not add silent fallbacks, skips, or old-LOM path guessing.
