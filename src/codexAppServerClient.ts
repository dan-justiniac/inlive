import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { buildCodexAppServerLaunch } from "./codexLaunchContext";
import type { ClientRequest, ServerNotification, ServerRequest } from "./generated/codex-app-server";
import type { InitializeResponse } from "./generated/codex-app-server/InitializeResponse";

export interface AppServerTransport extends EventEmitter {
  start(): void;
  sendLine(line: string): void;
  stop(): void;
}

type JsonRpcId = string | number;
type JsonRpcResponse = { id: JsonRpcId; result?: unknown; error?: unknown };
type JsonRpcRequest = { id: JsonRpcId; method: string; params?: unknown };
type JsonRpcNotification = { method: string; params?: unknown };

export class CodexAppServerClient {
  onNotification?: (notification: ServerNotification) => void;
  onServerRequest?: (request: ServerRequest) => void;
  onExit?: (code: number | null, outputTail: string) => void;
  onStderr?: (line: string) => void;

  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, { resolve(value: unknown): void; reject(error: Error): void }>();

  constructor(private readonly transport: AppServerTransport) {
    transport.on("line", (line) => this.receiveLine(String(line)));
    transport.on("stderr", (line) => this.onStderr?.(String(line)));
    transport.on("exit", (code, tail) => {
      const error = new Error(`app-server exited with code ${code}${tail ? `\n${tail}` : ""}`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.onExit?.(typeof code === "number" ? code : null, String(tail ?? ""));
    });
  }

  start() {
    this.transport.start();
  }

  stop() {
    this.transport.stop();
  }

  async initialize(): Promise<InitializeResponse> {
    const response = await this.request("initialize", {
      clientInfo: { name: "InLive", title: "InLive", version: "0.0.1" },
      capabilities: { experimentalApi: true },
    }) as InitializeResponse;
    this.notify("initialized");
    return response;
  }

  request<M extends ClientRequest["method"]>(
    method: M,
    params: Extract<ClientRequest, { method: M }>["params"],
  ): Promise<unknown> {
    const id = String(this.nextId++);
    this.send({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  respond(id: JsonRpcId, result: unknown) {
    this.send({ jsonrpc: "2.0", id, result });
  }

  reject(id: JsonRpcId, message: string) {
    this.send({ jsonrpc: "2.0", id, error: { code: -32000, message } });
  }

  private notify(method: "initialized") {
    this.send({ jsonrpc: "2.0", method });
  }

  private receiveLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message: JsonRpcResponse | JsonRpcRequest | JsonRpcNotification;
    try {
      message = JSON.parse(trimmed);
    } catch {
      this.onNotification?.({ method: "error", params: { message: `Invalid app-server JSON: ${redact(trimmed)}` } } as ServerNotification);
      return;
    }

    if ("id" in message && !("method" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if ("error" in message && message.error) {
        pending.reject(new Error(redact(JSON.stringify(message.error))));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    if ("id" in message && "method" in message) {
      this.onServerRequest?.(message as ServerRequest);
      return;
    }

    if ("method" in message) this.onNotification?.(message as ServerNotification);
  }

  private send(message: unknown) {
    this.transport.sendLine(JSON.stringify(message));
  }
}

export class ChildProcessAppServerTransport extends EventEmitter implements AppServerTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private tail = "";

  constructor(
    private readonly codexPath: string,
    private readonly cwd: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly spawnProcess: typeof spawn = spawn,
  ) {
    super();
  }

  start() {
    if (this.child) return;
    const launch = buildCodexAppServerLaunch(this.env);
    const child = this.spawnProcess(this.codexPath, launch.args, {
      cwd: this.cwd,
      env: launch.env,
      stdio: "pipe",
    });
    this.child = child;

    createInterface({ input: child.stdout }).on("line", (line) => this.emit("line", line));
    createInterface({ input: child.stderr }).on("line", (line) => {
      const redacted = redact(line);
      this.tail = appendTail(this.tail, `stderr: ${redacted}\n`);
      this.emit("stderr", redacted);
    });
    child.once("exit", (code) => {
      this.child = null;
      this.emit("exit", code, this.tail);
    });
    child.once("error", (error) => {
      this.child = null;
      this.emit("exit", null, error.message);
    });
  }

  sendLine(line: string) {
    if (!this.child?.stdin.writable) throw new Error("app-server stdin is closed");
    this.child.stdin.write(`${line}\n`);
  }

  stop() {
    this.child?.kill();
    this.child = null;
  }
}

function appendTail(current: string, line: string) {
  const next = current + line;
  return next.length > 20_000 ? next.slice(-20_000) : next;
}

function redact(value: string) {
  return value
    .replace(/Bearer\s+[^"'\s]+/g, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9._-]+/g, "sk-[REDACTED]")
    .replace(/([?&]token=)[^&"'\s]+/g, "$1[REDACTED]");
}
