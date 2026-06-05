import { writeFileSync } from "node:fs";

export const extensionStatusPath = "/tmp/inlive-extension-status.json";

export interface ExtensionStatus {
  pid: number;
  startedAt: string;
  updatedAt: string;
  manifestEntry: string;
  devServerUrl: string | null;
  expectedScopes: number;
  registeredScopes: number;
  registeredScopeNames: string[];
  lastRegisteredAt?: string;
  registrationErrors: Array<{ scope: string; message: string; at: string }>;
  lastCommandAt?: string;
  jsRunner?: { url: string; token: string; startedAt: string };
  jsRunnerError?: { message: string; at: string };
  codexDeveloperInstructions?: { version: number; hash: string };
}

export function createExtensionStatus(options: {
  manifestEntry: string;
  devServerUrl: string | null;
  expectedScopes: number;
  codexDeveloperInstructions?: { version: number; hash: string };
  now?: () => string;
  pid?: number;
}): ExtensionStatus {
  const now = (options.now ?? isoNow)();
  return {
    pid: options.pid ?? process.pid,
    startedAt: now,
    updatedAt: now,
    manifestEntry: options.manifestEntry,
    devServerUrl: options.devServerUrl,
    expectedScopes: options.expectedScopes,
    registeredScopes: 0,
    registeredScopeNames: [],
    registrationErrors: [],
    codexDeveloperInstructions: options.codexDeveloperInstructions,
  };
}

export function markContextMenuRegistered(status: ExtensionStatus, scope: string, now: () => string = isoNow) {
  const at = now();
  if (!status.registeredScopeNames.includes(scope)) status.registeredScopeNames.push(scope);
  status.registeredScopes = status.registeredScopeNames.length;
  status.lastRegisteredAt = at;
  status.updatedAt = at;
}

export function markContextMenuRegistrationFailed(status: ExtensionStatus, scope: string, message: string, now: () => string = isoNow) {
  const at = now();
  status.registrationErrors.push({ scope, message, at });
  status.updatedAt = at;
}

export function markCommandInvoked(status: ExtensionStatus, now: () => string = isoNow) {
  const at = now();
  status.lastCommandAt = at;
  status.updatedAt = at;
}

export function markHeartbeat(status: ExtensionStatus, now: () => string = isoNow) {
  status.updatedAt = now();
}

export function markJsRunnerStarted(status: ExtensionStatus, runner: { url: string; token: string }, now: () => string = isoNow) {
  const at = now();
  status.jsRunner = { ...runner, startedAt: at };
  delete status.jsRunnerError;
  status.updatedAt = at;
}

export function markJsRunnerFailed(status: ExtensionStatus, message: string, now: () => string = isoNow) {
  const at = now();
  status.jsRunnerError = { message, at };
  status.updatedAt = at;
}

export function writeExtensionStatus(status: ExtensionStatus, path = extensionStatusPath) {
  writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`);
}

function isoNow() {
  return new Date().toISOString();
}
