import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

export interface JsRunnerRequest {
  code: string;
  filename?: string;
  args?: unknown;
}

export interface JsRunnerLog {
  level: "log" | "warn" | "error";
  text: string;
}

export type JsRunnerValue =
  | { kind: "json"; value: unknown }
  | { kind: "text"; value: string }
  | { kind: "undefined" };

export type JsRunnerResponse =
  | { ok: true; result: JsRunnerValue; logs: JsRunnerLog[]; durationMs: number }
  | { ok: false; error: { message: string; stack?: string }; logs: JsRunnerLog[]; durationMs: number };

export interface JsRunnerServerOptions {
  live: unknown;
  sdk: unknown;
  port: number;
  token?: string;
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;

export class JsRunnerServer {
  readonly token: string;
  private readonly live: unknown;
  private readonly sdk: unknown;
  private readonly port: number;
  private server: Server | null = null;
  private actualPort = 0;

  constructor(options: JsRunnerServerOptions) {
    this.live = options.live;
    this.sdk = options.sdk;
    this.port = options.port;
    this.token = options.token ?? randomBytes(24).toString("hex");
  }

  get origin() {
    if (!this.actualPort) throw new Error("JS runner is not started.");
    return `http://127.0.0.1:${this.actualPort}`;
  }

  get url() {
    return `${this.origin}/run`;
  }

  async start() {
    if (this.server) return;
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error) => {
        writeJson(response, 500, { ok: false, error: String(error) });
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.port, "127.0.0.1", () => {
        this.server!.off("error", reject);
        const address = this.server!.address();
        if (!address || typeof address === "string") reject(new Error("JS runner did not bind to a TCP port."));
        else {
          this.actualPort = address.port;
          resolve();
        }
      });
    });
  }

  async close() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.actualPort = 0;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  async run(request: JsRunnerRequest): Promise<JsRunnerResponse> {
    const started = Date.now();
    const logs: JsRunnerLog[] = [];
    const runnerConsole = createRunnerConsole(logs);
    try {
      if (!request.code || typeof request.code !== "string") throw new Error("JS runner request requires string code.");
      const filename = request.filename ?? "inlive-snippet.js";
      const require = createRequire(pathToFileURL(filename).toString());
      const fn = new AsyncFunction("live", "sdk", "console", "args", "require", request.code);
      const result = await fn(this.live, this.sdk, runnerConsole, request.args ?? {}, require);
      return { ok: true, result: serializeResult(result), logs, durationMs: Date.now() - started };
    } catch (error) {
      return {
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        logs,
        durationMs: Date.now() - started,
      };
    }
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    if (request.headers["x-inlive-token"] !== this.token) {
      response.writeHead(401, { "content-type": "text/plain" });
      response.end("Invalid InLive JS runner token.");
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      writeJson(response, 200, { ok: true });
      return;
    }
    if (request.method !== "POST" || request.url !== "/run") {
      writeJson(response, 404, { ok: false, error: "Unknown InLive JS runner endpoint." });
      return;
    }
    const body = await readBody(request);
    writeJson(response, 200, await this.run(JSON.parse(body) as JsRunnerRequest));
  }
}

function createRunnerConsole(logs: JsRunnerLog[]) {
  const capture = (level: JsRunnerLog["level"], values: unknown[]) => {
    logs.push({ level, text: values.map(formatConsoleValue).join(" ") });
  };
  return {
    log: (...values: unknown[]) => capture("log", values),
    warn: (...values: unknown[]) => capture("warn", values),
    error: (...values: unknown[]) => capture("error", values),
  };
}

function serializeResult(value: unknown): JsRunnerValue {
  if (value === undefined) return { kind: "undefined" };
  try {
    JSON.stringify(value);
    return { kind: "json", value };
  } catch {
    return { kind: "text", value: inspect(value, { depth: 4 }) };
  }
}

function formatConsoleValue(value: unknown) {
  return typeof value === "string" ? value : inspect(value, { depth: 4 });
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}
