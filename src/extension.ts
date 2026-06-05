import * as sdk from "@ableton-extensions/sdk";
import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import { appendFileSync } from "node:fs";
import { CodexAppServerManager } from "./codexAppServerManager";
import { inLiveDeveloperInstructionsHash, inLiveDeveloperInstructionsVersion } from "./codexDeveloperInstructions";
import { resolveCodexPath } from "./codexPath";
import { contextMenuScopes } from "./contextScopes";
import { buildDevModalEndpoint, defaultJsRunnerPort, resolveDevServerUrl } from "./devMode";
import {
  createExtensionStatus,
  markJsRunnerFailed,
  markJsRunnerStarted,
  markCommandInvoked,
  markContextMenuRegistered,
  markContextMenuRegistrationFailed,
  markHeartbeat,
  writeExtensionStatus,
  type ExtensionStatus,
} from "./extensionStatus";
import { JsRunnerServer } from "./jsRunner";
import { ModalServer } from "./modalServer";
import { chatHtml } from "./webview";

const commandId = "inlive.openCodex";
const actionLabel = "In Live...";
const bridgeManager = new CodexAppServerManager();
const modalServer = new ModalServer();
let crashLoggingInstalled = false;
let status: ExtensionStatus | null = null;
let jsRunner: JsRunnerServer | null = null;

export function activate(activation: ActivationContext) {
  installCrashLogging();
  const context = initialize(activation, "1.0.0");
  status = createExtensionStatus({
    manifestEntry: "dist/extension.cjs",
    devServerUrl: resolveDevServerUrl(),
    expectedScopes: contextMenuScopes.length,
    codexDeveloperInstructions: {
      version: inLiveDeveloperInstructionsVersion,
      hash: inLiveDeveloperInstructionsHash,
    },
  });
  writeStatus();
  setInterval(() => {
    if (!status) return;
    markHeartbeat(status);
    writeStatus();
  }, 5_000).unref();
  log("activate");
  console.log("InLive activating.");
  if (status.devServerUrl) void startJsRunner(context);

  context.commands.registerCommand(commandId, (...args) => {
    log(`command invoked args=${args.length}`);
    if (status) {
      markCommandInvoked(status);
      writeStatus();
    }
    console.log(`InLive command invoked with ${args.length} argument(s).`);
    void openCodexChat(context).catch((error) => {
      log(`command failed ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      console.error(error);
    });
  });

  registerContextMenus(context);
}

async function startJsRunner(context: ReturnType<typeof initialize>) {
  if (jsRunner) return;
  try {
    jsRunner = new JsRunnerServer({
      live: context,
      sdk,
      port: defaultJsRunnerPort,
    });
    await jsRunner.start();
    if (status) {
      markJsRunnerStarted(status, { url: jsRunner.url, token: jsRunner.token });
      writeStatus();
    }
    log(`js runner started ${jsRunner.url}`);
    console.log(`InLive JS runner started at ${jsRunner.url}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (status) {
      markJsRunnerFailed(status, message);
      writeStatus();
    }
    log(`js runner failed ${message}`);
    console.error(`InLive JS runner failed: ${message}`);
  }
}

async function openCodexChat(context: ReturnType<typeof initialize>) {
  log("open chat");
  console.log("InLive opening Codex chat.");
  const devServerUrl = resolveDevServerUrl();
  if (devServerUrl) return openDevCodexChat(context, devServerUrl);

  const result = await bridgeManager.open({ codexPath: resolveCodexPath() });
  log(`bridge ${result.ok ? "ready" : `failed ${result.reason}: ${result.message}`}`);
  console.log(`InLive bridge ${result.ok ? "ready" : `failed: ${result.reason}`}.`);
  const html = result.ok
    ? chatHtml({ title: "InLive Codex", chat: { url: result.url, token: result.token } })
    : chatHtml({ title: "InLive Codex", error: result.message });
  const modalUrl = await modalServer.addPage(html);
  log(`modal url ${modalUrl}`);
  console.log(`InLive opening modal ${modalUrl}.`);

  try {
    await context.ui.showModalDialog(modalUrl, 520, 560);
    log("modal closed");
    console.log("InLive modal closed.");
  } catch (error) {
    log(`modal failed ${error instanceof Error ? error.message : String(error)}`);
    console.error("InLive modal failed:", error);
  }
}

async function openDevCodexChat(context: ReturnType<typeof initialize>, devServerUrl: string) {
  const endpoint = buildDevModalEndpoint(devServerUrl);
  log(`dev modal endpoint ${endpoint}`);
  try {
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`Dev bridge returned HTTP ${response.status}.`);
    const target = await response.json() as { modalUrl?: string; width?: number; height?: number };
    if (!target.modalUrl) throw new Error("Dev bridge response did not include modalUrl.");
    log(`dev modal url ${target.modalUrl}`);
    await context.ui.showModalDialog(target.modalUrl, target.width ?? 520, target.height ?? 560);
  } catch (error) {
    const message = `InLive dev bridge failed at ${endpoint}: ${error instanceof Error ? error.message : String(error)}`;
    log(message);
    const modalUrl = await modalServer.addPage(chatHtml({ title: "InLive Codex", error: message }));
    await context.ui.showModalDialog(modalUrl, 520, 560);
  }
}

function registerContextMenus(context: ReturnType<typeof initialize>) {
  let registered = 0;
  for (const scope of contextMenuScopes) {
    void context.ui.registerContextMenuAction(scope, actionLabel, commandId).then(
      () => {
        registered += 1;
        if (status) {
          markContextMenuRegistered(status, scope);
          writeStatus();
        }
        log(`registered ${scope} count=${registered}`);
        if (registered === contextMenuScopes.length) {
          log(`registered all ${registered}`);
          console.log(`InLive registered ${registered} context menu actions.`);
        }
      },
      (error) => {
        if (status) {
          markContextMenuRegistrationFailed(status, scope, error instanceof Error ? error.message : String(error));
          writeStatus();
        }
        log(`register failed ${scope}: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`Failed to register InLive menu for ${scope}:`, error);
      },
    );
  }
}

function writeStatus() {
  if (!status) return;
  try {
    writeExtensionStatus(status);
  } catch (error) {
    log(`status write failed ${error instanceof Error ? error.message : String(error)}`);
  }
}

function log(message: string) {
  try {
    appendFileSync("/tmp/inlive-extension.log", `${new Date().toISOString()} extension ${message}\n`);
  } catch {
    console.error(`[InLive] ${message}`);
  }
}

function installCrashLogging() {
  if (crashLoggingInstalled) return;
  crashLoggingInstalled = true;
  process.on("uncaughtException", (error) => {
    log(`uncaught ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    throw error;
  });
  process.on("unhandledRejection", (error) => {
    log(`unhandled ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  });
}
