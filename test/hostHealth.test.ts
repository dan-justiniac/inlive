import { describe, expect, test, vi } from "vitest";
import {
  buildExtensionHostInvocation,
  checkDoctor,
  ensureDevBridgeHealthy,
  filterInLiveHostProcesses,
  type DoctorDeps,
  type ProcessInfo,
} from "../src/hostHealth";

const cwd = "/Users/dan/Documents/InLive";
const status = {
  pid: 42,
  startedAt: "2026-06-05T10:00:00.000Z",
  updatedAt: "2026-06-05T10:00:10.000Z",
  manifestEntry: "dist/extension.cjs",
  devServerUrl: "http://127.0.0.1:15173",
  expectedScopes: 12,
  registeredScopes: 12,
  registeredScopeNames: [],
  registrationErrors: [],
};

function deps(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    cwd,
    now: () => new Date("2026-06-05T10:00:15.000Z"),
    manifestEntry: async () => "dist/extension.cjs",
    entryExportsActivate: async () => true,
    fetchDevHealth: async () => true,
    listProcesses: async () => [{ pid: 42, command: `node ExtensionHostNodeModule.node initialize ${cwd}` }],
    readStatus: async () => status,
    ...overrides,
  };
}

describe("host process detection", () => {
  test("selects only ExtensionHost processes for this extension path", () => {
    const processes: ProcessInfo[] = [
      { pid: 1, command: `node ExtensionHostNodeModule.node initialize ${cwd}` },
      { pid: 2, command: "node ExtensionHostNodeModule.node initialize /tmp/Other" },
      { pid: 3, command: `node scripts/dev.mjs ${cwd}` },
    ];

    expect(filterInLiveHostProcesses(processes, cwd)).toEqual([processes[0]]);
  });

  test("builds a direct ExtensionHost invocation for the Live app bundle", () => {
    const invocation = buildExtensionHostInvocation(cwd, "/Applications/Ableton Live 12 Beta.app");

    expect(invocation.nodeExecutable).toBe("/Applications/Ableton Live 12 Beta.app/Contents/Helpers/ExtensionHost/node");
    expect(invocation.args[0]).toBe("-e");
    expect(invocation.args[1]).toContain("ExtensionHostNodeModule.node");
    expect(invocation.args[1]).toContain("/Users/dan/Documents/InLive");
  });
});

describe("doctor checks", () => {
  test("passes when every layer is healthy", async () => {
    await expect(checkDoctor(deps())).resolves.toMatchObject({ ok: true });
  });

  test("fails explicitly when activate is not exported", async () => {
    const result = await checkDoctor(deps({ entryExportsActivate: async () => false }));
    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.id === "entry")?.message).toContain("activate");
  });

  test("fails explicitly when the dev bridge is down", async () => {
    const result = await checkDoctor(deps({ fetchDevHealth: async () => false }));
    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.id === "dev-health")?.message).toContain("not healthy");
  });

  test("fails explicitly with zero or duplicate host processes", async () => {
    await expect(checkDoctor(deps({ listProcesses: async () => [] }))).resolves.toMatchObject({ ok: false });
    await expect(checkDoctor(deps({
      listProcesses: async () => [
        { pid: 1, command: `node ExtensionHostNodeModule.node ${cwd}` },
        { pid: 2, command: `node ExtensionHostNodeModule.node ${cwd}` },
      ],
    }))).resolves.toMatchObject({ ok: false });
  });

  test("fails explicitly when status is stale or partially registered", async () => {
    await expect(checkDoctor(deps({
      readStatus: async () => ({ ...status, updatedAt: "2026-06-05T09:59:00.000Z" }),
    }))).resolves.toMatchObject({ ok: false });
    await expect(checkDoctor(deps({
      readStatus: async () => ({ ...status, registeredScopes: 11 }),
    }))).resolves.toMatchObject({ ok: false });
  });

  test("kills only InLive ExtensionHost processes", async () => {
    const kill = vi.fn();
    const processes: ProcessInfo[] = [
      { pid: 1, command: `node ExtensionHostNodeModule.node ${cwd}` },
      { pid: 2, command: "node ExtensionHostNodeModule.node /tmp/Other" },
    ];

    const { stopInLiveHosts } = await import("../src/hostHealth");
    const killed = await stopInLiveHosts({ cwd, listProcesses: async () => processes, killProcess: kill });

    expect(killed).toEqual([1]);
    expect(kill).toHaveBeenCalledWith(1);
  });

  test("fails launch preflight when the dev bridge health endpoint is not InLive", async () => {
    await expect(ensureDevBridgeHealthy(async () => ({ ok: false, status: 404, body: "wrong app" })))
      .rejects.toThrow("InLive dev bridge is not healthy");
  });
});
