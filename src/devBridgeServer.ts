import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFileSync } from "node:fs";
import { CodexAppServerManager, type AppServerOpenResult } from "./codexAppServerManager";
import { resolveCodexPath } from "./codexPath";
import {
  buildDevErrorModalUrl,
  buildDevModalUrl,
  defaultDevBridgeUrl,
  defaultDevServerUrl,
  defaultDevWebSocketPort,
} from "./devMode";

export interface DevBridgeResponse {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

export interface DevBridgeHandlerOptions {
  viteUrl?: string;
  openBridge: () => Promise<AppServerOpenResult>;
}

export function createDevBridgeHandler(options: DevBridgeHandlerOptions) {
  const viteUrl = options.viteUrl ?? defaultDevServerUrl;

  return async function handle(request: Pick<IncomingMessage, "method" | "url">): Promise<DevBridgeResponse> {
    if (request.method === "GET" && request.url === "/inlive-dev/health") {
      return json({ ok: true });
    }

    if (request.method === "GET" && request.url === "/inlive-dev/modal") {
      const result = await options.openBridge();
      const modalUrl = result.ok ? buildDevModalUrl(viteUrl, result) : buildDevErrorModalUrl(viteUrl, result.message);
      return json({ modalUrl, width: 520, height: 560 });
    }

    return json({ error: `Unsupported dev bridge route: ${request.method ?? "(unknown)"} ${request.url ?? "(unknown)"}` }, 404);
  };
}

export function startDevBridgeServer(options: {
  bridgeUrl?: string;
  viteUrl?: string;
  manager?: CodexAppServerManager;
} = {}) {
  const bridgeUrl = new URL(options.bridgeUrl ?? process.env.INLIVE_DEV_BRIDGE_URL ?? defaultDevBridgeUrl);
  const manager = options.manager ?? new CodexAppServerManager({
    cwd: "/Users/dan/Documents/InLive",
    webSocketPort: Number(process.env.INLIVE_DEV_WS_PORT ?? defaultDevWebSocketPort),
  });
  const handler = createDevBridgeHandler({
    viteUrl: options.viteUrl ?? process.env.INLIVE_DEV_SERVER_URL ?? defaultDevServerUrl,
    openBridge: () => manager.open({ codexPath: resolveCodexPath() }),
  });
  const server = createServer((request, response) => {
    void handler(request).then(
      (result) => send(response, result),
      (error) => send(response, json({ error: error instanceof Error ? error.message : String(error) }, 500)),
    );
  });

  server.listen(Number(bridgeUrl.port), bridgeUrl.hostname, () => {
    log(`dev bridge listening ${bridgeUrl.toString()}`);
  });

  const stop = () => {
    manager.dispose();
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return { server, manager, stop };
}

function json(body: unknown, status = 200): DevBridgeResponse {
  return {
    status,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
  };
}

function send(response: ServerResponse, result: DevBridgeResponse) {
  response.writeHead(result.status, result.headers);
  response.end(result.body);
}

function log(message: string) {
  try {
    appendFileSync("/tmp/inlive-dev-bridge.log", `${new Date().toISOString()} ${message}\n`);
  } catch {
    console.error(`[InLive dev bridge] ${message}`);
  }
}
