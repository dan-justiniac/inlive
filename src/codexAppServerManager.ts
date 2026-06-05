import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { WebSocket, WebSocketServer } from "ws";
import { ChildProcessAppServerTransport, CodexAppServerClient, type AppServerTransport } from "./codexAppServerClient";
import { buildInLiveDeveloperInstructions } from "./codexDeveloperInstructions";
import { buildCodexLaunchConfigHash, codexShellEnvironmentPolicyConfig } from "./codexLaunchContext";
import type { ServerNotification, ServerRequest } from "./generated/codex-app-server";
import type { ThreadStartResponse } from "./generated/codex-app-server/v2/ThreadStartResponse";
import type { TurnStartResponse } from "./generated/codex-app-server/v2/TurnStartResponse";

export type ChatStatus = "starting" | "ready" | "thinking" | "streaming" | "error" | "disconnected";
export type ChatRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  status?: string;
}

export interface PendingRequest {
  id: string | number;
  method: string;
  title: string;
  body: string;
  params: unknown;
}

export interface ChatSnapshot {
  status: ChatStatus;
  threadId: string | null;
  turnId: string | null;
  messages: ChatMessage[];
  pendingRequests: PendingRequest[];
  error: string | null;
}

export type AppServerOpenResult =
  | { ok: true; url: string; token: string }
  | { ok: false; reason: "codex-not-found"; message: string }
  | { ok: false; reason: "spawn-failed"; message: string };

export interface CodexAppServerManagerOptions {
  cwd?: string;
  webSocketHost?: string;
  webSocketPort?: number;
  createTransport?: (codexPath: string, cwd: string) => AppServerTransport;
}

type BrowserMessage =
  | { type: "send"; text: string }
  | { type: "interrupt" }
  | { type: "approve"; requestId: string | number; decision?: "accept" | "decline" | "cancel"; answers?: Record<string, string[]> }
  | { type: "close" };

export class CodexAppServerManager {
  private client: CodexAppServerClient | null = null;
  private server: WebSocketServer | null = null;
  private token: string | null = null;
  private url: string | null = null;
  private starting: Promise<void> | null = null;
  private status: ChatStatus = "disconnected";
  private threadId: string | null = null;
  private turnId: string | null = null;
  private error: string | null = null;
  private activeLaunchHash: string | null = null;
  private readonly messages: ChatMessage[] = [];
  private readonly pendingRequests = new Map<string | number, PendingRequest>();
  private readonly clients = new Set<WebSocket>();
  private readonly cwd: string;
  private readonly webSocketHost: string;
  private readonly webSocketPort: number;
  private readonly createTransport: (codexPath: string, cwd: string) => AppServerTransport;

  constructor(options: CodexAppServerManagerOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.webSocketHost = options.webSocketHost ?? "127.0.0.1";
    this.webSocketPort = options.webSocketPort ?? 0;
    this.createTransport = options.createTransport ?? ((codexPath, cwd) => new ChildProcessAppServerTransport(codexPath, cwd));
  }

  async open(options: { codexPath?: string | null } = {}): Promise<AppServerOpenResult> {
    log("open requested");
    if (options.codexPath === null) {
      log("codex not found");
      return {
        ok: false,
        reason: "codex-not-found",
        message: "Codex was not found. Install Codex with npm install -g @openai/codex, then retry.",
      };
    }

    const codexPath = options.codexPath ?? "codex";
    const launchHash = buildCodexLaunchConfigHash({ codexPath, cwd: this.cwd });
    if (this.activeLaunchHash && this.activeLaunchHash !== launchHash) {
      const error = this.handleLaunchContextChange();
      if (error) return { ok: false, reason: "spawn-failed", message: error };
      this.dispose();
    }

    try {
      await this.ensureStarted(codexPath, launchHash);
      await this.ensureWebSocket();
      log(`open ready url=${this.url}`);
      return { ok: true, url: this.url!, token: this.token! };
    } catch (error) {
      if (!this.error) this.fail(error instanceof Error ? error.message : String(error));
      return { ok: false, reason: "spawn-failed", message: this.error! };
    }
  }

  snapshot(): ChatSnapshot {
    return {
      status: this.status,
      threadId: this.threadId,
      turnId: this.turnId,
      messages: [...this.messages],
      pendingRequests: [...this.pendingRequests.values()],
      error: this.error,
    };
  }

  dispose() {
    this.client?.stop();
    this.client = null;
    for (const client of this.clients) client.close(1001, "InLive disposed");
    this.clients.clear();
    this.server?.close();
    this.server = null;
    this.token = null;
    this.url = null;
    this.status = "disconnected";
    this.threadId = null;
    this.turnId = null;
    this.activeLaunchHash = null;
  }

  async send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!this.client || !this.threadId) throw new Error("Codex app-server is not ready.");
    if (this.turnId) {
      this.addMessage("system", "A Codex turn is already running. Stop it before sending another message.");
      return;
    }

    this.error = null;
    this.addMessage("user", trimmed);
    this.status = "thinking";
    this.broadcast({ type: "snapshot", snapshot: this.snapshot() });

    const response = await this.client.request("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text: trimmed, text_elements: [] }],
    }) as TurnStartResponse;
    this.turnId = response.turn.id;
    this.status = "thinking";
    this.broadcast({ type: "snapshot", snapshot: this.snapshot() });
  }

  async interrupt() {
    if (!this.client || !this.threadId || !this.turnId) return;
    await this.client.request("turn/interrupt", { threadId: this.threadId, turnId: this.turnId });
  }

  approve(requestId: string | number, decision: "accept" | "decline" | "cancel" = "accept", answers: Record<string, string[]> = {}) {
    const request = this.pendingRequests.get(requestId);
    if (!request || !this.client) return;
    this.pendingRequests.delete(requestId);

    if (request.method === "item/commandExecution/requestApproval" || request.method === "item/fileChange/requestApproval") {
      this.client.respond(requestId, { decision });
    } else if (request.method === "item/tool/requestUserInput") {
      this.client.respond(requestId, {
        answers: Object.fromEntries(Object.entries(answers).map(([id, answer]) => [id, { answers: answer }])),
      });
    } else if (request.method === "mcpServer/elicitation/request") {
      this.client.respond(requestId, { action: decision, content: null, _meta: null });
    } else if (request.method === "item/permissions/requestApproval") {
      const params = request.params as { permissions?: { network?: unknown; fileSystem?: unknown } };
      this.client.respond(requestId, {
        permissions: { network: params.permissions?.network ?? undefined, fileSystem: params.permissions?.fileSystem ?? undefined },
        scope: "turn",
      });
    } else {
      this.client.reject(requestId, `InLive does not support ${request.method}.`);
    }

    this.broadcast({ type: "snapshot", snapshot: this.snapshot() });
  }

  private async ensureStarted(codexPath: string, launchHash: string) {
    if (this.client && this.threadId && this.status !== "disconnected") return;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      this.status = "starting";
      this.error = null;
      log(`starting app-server path=${codexPath} cwd=${this.cwd}`);
      const client = new CodexAppServerClient(this.createTransport(codexPath, this.cwd));
      this.client = client;
      client.onNotification = (notification) => this.handleNotification(notification);
      client.onServerRequest = (request) => this.handleServerRequest(request);
      client.onExit = (_code, tail) => this.fail(`Codex app-server disconnected.${tail ? `\n${tail}` : ""}`);
      client.onStderr = (line) => log(`app-server stderr ${line}`);
      client.start();
      await client.initialize();
      const response = await client.request("thread/start", {
        cwd: this.cwd,
        developerInstructions: buildInLiveDeveloperInstructions(),
        config: { shell_environment_policy: codexShellEnvironmentPolicyConfig },
        serviceName: "InLive",
        sessionStartSource: "startup",
        threadSource: "user",
      }) as ThreadStartResponse;
      this.threadId = response.thread.id;
      this.activeLaunchHash = launchHash;
      this.status = "ready";
      log(`thread ready id=${this.threadId}`);
      this.broadcast({ type: "snapshot", snapshot: this.snapshot() });
    })();

    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async ensureWebSocket() {
    if (this.server) return;
    this.token = randomBytes(24).toString("hex");
    this.server = new WebSocketServer({ host: this.webSocketHost, port: this.webSocketPort });
    this.server.on("connection", (socket, request) => {
      try {
        log(`websocket connection url=${request.url ?? ""}`);
        const token = readToken(request.url ?? "");
        if (token !== this.token) {
          log(`websocket rejected invalid token got=${token ?? "<none>"} expected=${this.token ?? "<none>"}`);
          socket.close(1008, "Invalid token");
          return;
        }

        this.clients.add(socket);
        log(`websocket accepted clients=${this.clients.size}`);
        socket.send(JSON.stringify({ type: "snapshot", snapshot: this.snapshot() }));
        socket.on("message", (data) => void this.handleBrowserMessage(data.toString()).catch((error) => {
          this.fail(error instanceof Error ? error.message : String(error));
        }));
        socket.on("error", (error) => log(`websocket error ${error instanceof Error ? error.message : String(error)}`));
        socket.on("close", (code, reason) => {
          this.clients.delete(socket);
          log(`websocket closed code=${code} reason=${reason.toString()} clients=${this.clients.size}`);
        });
      } catch (error) {
        log(`websocket handler failed ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        socket.close(1011, "InLive handler failed");
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once("listening", resolve);
      this.server!.once("error", reject);
    });

    const address = this.server.address();
    if (typeof address !== "object" || !address) throw new Error("Chat WebSocket server did not expose a port.");
    this.url = `ws://${this.webSocketHost}:${address.port}`;
    log(`websocket listening ${this.url}`);
  }

  private async handleBrowserMessage(raw: string) {
    const message = JSON.parse(raw) as BrowserMessage;
    if (message.type === "send") await this.send(message.text);
    if (message.type === "interrupt") await this.interrupt();
    if (message.type === "approve") this.approve(message.requestId, message.decision, message.answers);
  }

  private handleNotification(notification: ServerNotification) {
    if (notification.method === "item/agentMessage/delta") {
      const params = notification.params;
      this.turnId = params.turnId;
      this.status = "streaming";
      this.upsertMessage(params.itemId, "assistant", params.delta);
    } else if (notification.method === "item/started" || notification.method === "item/completed") {
      this.upsertItem(notification.params.item);
    } else if (notification.method === "turn/started") {
      this.turnId = notification.params.turn.id;
      this.status = "thinking";
    } else if (notification.method === "turn/completed") {
      this.turnId = null;
      this.status = notification.params.turn.status === "failed" ? "error" : "ready";
      if (notification.params.turn.error) this.addMessage("system", notification.params.turn.error.message);
    } else if (notification.method === "error") {
      this.fail(notification.params.message);
      return;
    }
    this.broadcast({ type: "snapshot", snapshot: this.snapshot() });
  }

  private handleServerRequest(request: ServerRequest) {
    const pending = {
      id: request.id,
      method: request.method,
      title: requestTitle(request),
      body: requestBody(request),
      params: request.params,
    };
    this.pendingRequests.set(request.id, pending);
    this.broadcast({ type: "snapshot", snapshot: this.snapshot() });
  }

  private upsertItem(item: { id: string; type: string; text?: string; command?: string; status?: string; aggregatedOutput?: string | null; tool?: string; server?: string }) {
    if (item.type === "userMessage") return;
    if (item.type === "agentMessage") {
      this.setMessage(item.id, "assistant", item.text ?? "");
      return;
    }
    if (item.type === "plan") {
      this.setMessage(item.id, "tool", item.text ?? "");
      return;
    }
    if (item.type === "commandExecution") {
      this.setMessage(item.id, "tool", `$ ${item.command}${item.aggregatedOutput ? `\n${item.aggregatedOutput}` : ""}`, item.status);
      return;
    }
    if (item.type === "mcpToolCall") {
      this.setMessage(item.id, "tool", `${item.server ?? "MCP"}:${item.tool ?? "tool"}`, item.status);
      return;
    }
    this.setMessage(item.id, "tool", `${item.type}${item.status ? `: ${item.status}` : ""}`, item.status);
  }

  private addMessage(role: ChatRole, text: string) {
    this.messages.push({ id: randomBytes(8).toString("hex"), role, text });
  }

  private upsertMessage(id: string, role: ChatRole, delta: string) {
    const existing = this.messages.find((message) => message.id === id);
    if (existing) existing.text += delta;
    else this.messages.push({ id, role, text: delta });
  }

  private setMessage(id: string, role: ChatRole, text: string, status?: string) {
    const existing = this.messages.find((message) => message.id === id);
    if (existing) Object.assign(existing, { role, text, status });
    else this.messages.push({ id, role, text, status });
  }

  private fail(message: string) {
    log(`fail ${message}`);
    this.status = "error";
    this.error = message;
    this.client = null;
    this.threadId = null;
    this.turnId = null;
    this.addMessage("system", message);
    this.broadcast({ type: "snapshot", snapshot: this.snapshot() });
  }

  private handleLaunchContextChange() {
    if (!this.turnId) return null;
    const message = "Codex launch context changed; stop the active turn before restarting Codex.";
    this.status = "error";
    this.error = message;
    this.addMessage("system", message);
    this.broadcast({ type: "snapshot", snapshot: this.snapshot() });
    return message;
  }

  private broadcast(message: unknown) {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }
}

function log(message: string) {
  try {
    appendFileSync("/tmp/inlive-extension.log", `${new Date().toISOString()} ${message}\n`);
  } catch {
    console.error(`[InLive] ${message}`);
  }
}

function readToken(url: string) {
  const query = url.split("?", 2)[1];
  if (!query) return null;
  for (const part of query.split("&")) {
    const [key, value = ""] = part.split("=", 2);
    if (key === "token") return decodeURIComponent(value.replace(/\+/g, " "));
  }
  return null;
}

function requestTitle(request: ServerRequest) {
  if (request.method === "item/commandExecution/requestApproval") return "Approve command";
  if (request.method === "item/fileChange/requestApproval") return "Approve file change";
  if (request.method === "item/tool/requestUserInput") return "Input requested";
  if (request.method === "mcpServer/elicitation/request") return "MCP input requested";
  if (request.method === "item/permissions/requestApproval") return "Approve permissions";
  return `Unsupported request: ${request.method}`;
}

function requestBody(request: ServerRequest) {
  const params = request.params as Record<string, unknown>;
  if ("command" in params && params.command) return String(params.command);
  if ("reason" in params && params.reason) return String(params.reason);
  return JSON.stringify(params, null, 2);
}
