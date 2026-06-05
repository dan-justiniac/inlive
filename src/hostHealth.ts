import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { contextMenuScopes } from "./contextScopes";
import { defaultDevServerUrl } from "./devMode";
import { extensionStatusPath, type ExtensionStatus } from "./extensionStatus";

export const defaultLivePath = "/Applications/Ableton Live 12 Beta.app";
const defaultStatusMaxAgeMs = 15_000;

export interface ProcessInfo {
  pid: number;
  command: string;
}

export interface DoctorCheck {
  id: string;
  ok: boolean;
  message: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

export interface DoctorDeps {
  cwd: string;
  now: () => Date;
  manifestEntry: () => Promise<string>;
  entryExportsActivate: () => Promise<boolean>;
  fetchDevHealth: () => Promise<boolean>;
  listProcesses: () => Promise<ProcessInfo[]>;
  readStatus: () => Promise<ExtensionStatus | null>;
  statusMaxAgeMs?: number;
}

export function filterInLiveHostProcesses(processes: ProcessInfo[], cwd: string) {
  return processes.filter((process) => process.command.includes("ExtensionHostNodeModule.node") && process.command.includes(cwd));
}

export async function checkDoctor(deps: DoctorDeps): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  const entry = await deps.manifestEntry().catch(() => null);
  const entryOk = Boolean(entry && await deps.entryExportsActivate().catch(() => false));
  checks.push({
    id: "entry",
    ok: entryOk,
    message: entryOk ? `entry ${entry} exports activate` : `entry ${entry ?? "(missing)"} does not export activate`,
  });

  const devOk = await deps.fetchDevHealth().catch(() => false);
  checks.push({
    id: "dev-health",
    ok: devOk,
    message: devOk ? "dev bridge is healthy" : "dev bridge is not healthy",
  });

  const hosts = filterInLiveHostProcesses(await deps.listProcesses(), deps.cwd);
  checks.push({
    id: "host-singleton",
    ok: hosts.length === 1,
    message: hosts.length === 1 ? `one ExtensionHost pid=${hosts[0]!.pid}` : `expected one ExtensionHost, found ${hosts.length}`,
  });

  const status = await deps.readStatus().catch(() => null);
  const expectedScopes = contextMenuScopes.length;
  const statusAge = status ? deps.now().getTime() - new Date(status.updatedAt).getTime() : Number.POSITIVE_INFINITY;
  const statusOk = Boolean(
    status
    && status.registeredScopes === expectedScopes
    && status.registrationErrors.length === 0
    && statusAge <= (deps.statusMaxAgeMs ?? defaultStatusMaxAgeMs),
  );
  checks.push({
    id: "activation-status",
    ok: statusOk,
    message: statusOk
      ? `status reports ${expectedScopes} registered scopes`
      : statusMessage(status, statusAge, deps.statusMaxAgeMs ?? defaultStatusMaxAgeMs, expectedScopes),
  });

  return { ok: checks.every((check) => check.ok), checks };
}

export async function ensureDevBridgeHealthy(fetchHealth: () => Promise<{ ok: boolean; status: number; body: string }> = fetchDevBridgeHealth) {
  const health = await fetchHealth();
  if (!health.ok) {
    throw new Error(`InLive dev bridge is not healthy at ${defaultDevServerUrl}/inlive-dev/health (HTTP ${health.status}). ${health.body}`);
  }
}

export async function defaultDoctorDeps(cwd = process.cwd()): Promise<DoctorDeps> {
  return {
    cwd,
    now: () => new Date(),
    manifestEntry: async () => JSON.parse(readFileSync(join(cwd, "manifest.json"), "utf8")).entry,
    entryExportsActivate: async () => {
      const manifest = JSON.parse(readFileSync(join(cwd, "manifest.json"), "utf8")) as { entry: string };
      const entryPath = join(cwd, manifest.entry);
      if (!existsSync(entryPath)) return false;
      const require = createRequire(import.meta.url);
      return typeof require(entryPath).activate === "function";
    },
    fetchDevHealth: async () => {
      return (await fetchDevBridgeHealth()).ok;
    },
    listProcesses: listProcesses,
    readStatus: async () => {
      if (!existsSync(extensionStatusPath)) return null;
      return JSON.parse(readFileSync(extensionStatusPath, "utf8")) as ExtensionStatus;
    },
  };
}

async function fetchDevBridgeHealth() {
  const response = await fetch(`${defaultDevServerUrl}/inlive-dev/health`);
  return { ok: response.ok, status: response.status, body: await response.text() };
}

export async function runDoctor(cwd = process.cwd()) {
  return checkDoctor(await defaultDoctorDeps(cwd));
}

export async function listProcesses(): Promise<ProcessInfo[]> {
  const result = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "ps failed");
  return result.stdout.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), command: match[2]! }] : [];
  });
}

export async function stopInLiveHosts(options: {
  cwd: string;
  listProcesses?: () => Promise<ProcessInfo[]>;
  killProcess?: (pid: number) => void;
}) {
  const processes = filterInLiveHostProcesses(await (options.listProcesses ?? listProcesses)(), options.cwd);
  const killProcess = options.killProcess ?? ((pid) => process.kill(pid, "SIGTERM"));
  for (const host of processes) killProcess(host.pid);
  return processes.map((host) => host.pid);
}

export function buildExtensionHostInvocation(cwd: string, livePath = defaultLivePath) {
  const extensionHostDir = join(livePath, "Contents", "Helpers", "ExtensionHost");
  const nodeExecutable = join(extensionHostDir, "node");
  const nodeModule = join(extensionHostDir, "ExtensionHostNodeModule.node");
  const payload = { extensions: [{ path: cwd.replace(/\\/g, "/") }] };
  return {
    nodeExecutable,
    args: ["-e", `require(${JSON.stringify(nodeModule.replace(/\\/g, "/"))}).initialize(${JSON.stringify(payload)});`],
  };
}

export function clearExtensionStatus(path = extensionStatusPath) {
  rmSync(path, { force: true });
}

export async function waitForActivation(options: {
  readStatus?: () => Promise<ExtensionStatus | null>;
  timeoutMs?: number;
  intervalMs?: number;
  expectedScopes?: number;
} = {}) {
  const readStatus = options.readStatus ?? (async () => existsSync(extensionStatusPath)
    ? JSON.parse(readFileSync(extensionStatusPath, "utf8")) as ExtensionStatus
    : null);
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  const expectedScopes = options.expectedScopes ?? contextMenuScopes.length;
  while (Date.now() < deadline) {
    const status = await readStatus();
    if (status?.registeredScopes === expectedScopes && status.registrationErrors.length === 0) return status;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 200));
  }
  throw new Error(`Timed out waiting for ${expectedScopes} registered InLive context menu scopes.`);
}

export function spawnLiveDevHost(cwd = process.cwd(), livePath = defaultLivePath) {
  const invocation = buildExtensionHostInvocation(cwd, livePath);
  console.log("Starting Extension Host...");
  console.log(`  Extension: ${cwd}`);
  console.log(`  Live: ${livePath}`);
  console.log();
  return spawn(invocation.nodeExecutable, invocation.args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, INLIVE_DEV_SERVER_URL: defaultDevServerUrl },
  });
}

function statusMessage(status: ExtensionStatus | null, age: number, maxAge: number, expectedScopes: number) {
  if (!status) return "activation status file is missing";
  if (age > maxAge) return `activation status is stale (${age}ms old)`;
  if (status.registrationErrors.length) return `registration errors: ${status.registrationErrors.map((error) => `${error.scope}: ${error.message}`).join("; ")}`;
  return `expected ${expectedScopes} registered scopes, got ${status.registeredScopes}`;
}
