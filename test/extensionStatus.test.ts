import { describe, expect, test } from "vitest";
import {
  createExtensionStatus,
  markCommandInvoked,
  markContextMenuRegistered,
  markContextMenuRegistrationFailed,
  markHeartbeat,
  markJsRunnerFailed,
  markJsRunnerStarted,
} from "../src/extensionStatus";

describe("extension status", () => {
  test("records activation and successful context menu registration progress", () => {
    const status = createExtensionStatus({
      manifestEntry: "dist/extension.cjs",
      devServerUrl: "http://127.0.0.1:15173",
      expectedScopes: 12,
      now: () => "2026-06-05T10:00:00.000Z",
      pid: 123,
      codexDeveloperInstructions: { version: 1, hash: "abc" },
    });

    markContextMenuRegistered(status, "AudioClip", () => "2026-06-05T10:00:01.000Z");
    markContextMenuRegistered(status, "MidiClip", () => "2026-06-05T10:00:02.000Z");

    expect(status).toMatchObject({
      pid: 123,
      startedAt: "2026-06-05T10:00:00.000Z",
      manifestEntry: "dist/extension.cjs",
      devServerUrl: "http://127.0.0.1:15173",
      codexDeveloperInstructions: { version: 1, hash: "abc" },
      expectedScopes: 12,
      registeredScopes: 2,
      lastRegisteredAt: "2026-06-05T10:00:02.000Z",
      registrationErrors: [],
    });
    expect(status.registeredScopeNames).toEqual(["AudioClip", "MidiClip"]);
  });

  test("records registration errors, command invocations, and heartbeat updates", () => {
    const status = createExtensionStatus({
      manifestEntry: "dist/extension.cjs",
      devServerUrl: null,
      expectedScopes: 12,
      now: () => "2026-06-05T10:00:00.000Z",
      pid: 123,
      codexDeveloperInstructions: { version: 1, hash: "abc" },
    });

    markContextMenuRegistrationFailed(status, "Scene", "failed", () => "2026-06-05T10:00:01.000Z");
    markCommandInvoked(status, () => "2026-06-05T10:00:02.000Z");
    markHeartbeat(status, () => "2026-06-05T10:00:03.000Z");

    expect(status.registrationErrors).toEqual([{ scope: "Scene", message: "failed", at: "2026-06-05T10:00:01.000Z" }]);
    expect(status.lastCommandAt).toBe("2026-06-05T10:00:02.000Z");
    expect(status.updatedAt).toBe("2026-06-05T10:00:03.000Z");
  });

  test("records JS runner startup and explicit failures", () => {
    const status = createExtensionStatus({
      manifestEntry: "dist/extension.cjs",
      devServerUrl: "http://127.0.0.1:15173",
      expectedScopes: 12,
      now: () => "2026-06-05T10:00:00.000Z",
      pid: 123,
    });

    markJsRunnerStarted(status, { url: "http://127.0.0.1:15176/run", token: "secret" }, () => "2026-06-05T10:00:01.000Z");
    expect(status.jsRunner).toEqual({
      url: "http://127.0.0.1:15176/run",
      token: "secret",
      startedAt: "2026-06-05T10:00:01.000Z",
    });
    expect(status.jsRunnerError).toBeUndefined();

    markJsRunnerFailed(status, "port busy", () => "2026-06-05T10:00:02.000Z");
    expect(status.jsRunnerError).toEqual({
      message: "port busy",
      at: "2026-06-05T10:00:02.000Z",
    });
  });
});
