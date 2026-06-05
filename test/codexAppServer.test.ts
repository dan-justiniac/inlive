import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import { ChildProcessAppServerTransport, CodexAppServerClient, type AppServerTransport } from "../src/codexAppServerClient";
import { CodexAppServerManager } from "../src/codexAppServerManager";

class FakeTransport extends EventEmitter implements AppServerTransport {
  readonly sent: unknown[] = [];
  running = false;

  start() {
    this.running = true;
  }

  sendLine(line: string) {
    this.sent.push(JSON.parse(line));
  }

  stop() {
    this.running = false;
  }

  line(message: unknown) {
    this.emit("line", JSON.stringify(message));
  }

  exit(code = 1) {
    this.running = false;
    this.emit("exit", code, "stderr tail");
  }

  stderr(line: string) {
    this.emit("stderr", line);
  }
}

async function waitForSent(transport: FakeTransport, method: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const message = transport.sent.find((sent) => (sent as { method?: string }).method === method);
    if (message) return message as { id: string };
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`Timed out waiting for ${method}`);
}

describe("CodexAppServerClient", () => {
  test("initializes with V2 experimental capability then sends initialized", async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    const initialized = client.initialize();

    expect(transport.sent[0]).toMatchObject({
      jsonrpc: "2.0",
      method: "initialize",
      params: { clientInfo: { name: "InLive" }, capabilities: { experimentalApi: true } },
    });

    transport.line({ jsonrpc: "2.0", id: (transport.sent[0] as { id: string }).id, result: { userAgent: "codex" } });
    await initialized;

    expect(transport.sent[1]).toEqual({ jsonrpc: "2.0", method: "initialized" });
  });

  test("sends V2 turn/start text input", async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    const response = client.request("turn/start", {
      threadId: "thread-1",
      input: [{ type: "text", text: "hello", text_elements: [] }],
    });

    expect(transport.sent[0]).toMatchObject({
      method: "turn/start",
      params: { threadId: "thread-1", input: [{ type: "text", text: "hello", text_elements: [] }] },
    });

    transport.line({ jsonrpc: "2.0", id: (transport.sent[0] as { id: string }).id, result: { turn: { id: "turn-1" } } });
    await expect(response).resolves.toMatchObject({ turn: { id: "turn-1" } });
  });

  test("surfaces server requests and sends typed responses", () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    const seen: string[] = [];
    client.onServerRequest = (request) => seen.push(`${request.method}:${request.id}`);

    transport.line({
      jsonrpc: "2.0",
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: { command: "pwd", cwd: "/tmp", reason: "test" },
    });
    client.respond("approval-1", { decision: "accept" });

    expect(seen).toEqual(["item/commandExecution/requestApproval:approval-1"]);
    expect(transport.sent[0]).toEqual({ jsonrpc: "2.0", id: "approval-1", result: { decision: "accept" } });
  });
});

describe("ChildProcessAppServerTransport", () => {
  test("spawns Codex with app-server launch args and generated environment", () => {
    const spawn = vi.fn(() => ({
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: { writable: true, write: vi.fn() },
      once: vi.fn(),
    }));
    const transport = new ChildProcessAppServerTransport("/bin/codex", "/tmp/inlive", { PATH: "/usr/bin" }, spawn as never);

    transport.start();

    expect(spawn).toHaveBeenCalledWith(
      "/bin/codex",
      [
        "app-server",
        "--listen",
        "stdio://",
        "-c",
        "shell_environment_policy.inherit=all",
        "-c",
        "shell_environment_policy.include_only=[\"PATH\",\"HOME\",\"USER\",\"TMPDIR\",\"SHELL\"]",
      ],
      expect.objectContaining({
        cwd: "/tmp/inlive",
        env: expect.objectContaining({
          PATH: "/Users/dan/Documents/InLive/bin:/usr/bin",
          INLIVE_JS_RUNNER_STATUS: "/tmp/inlive-extension-status.json",
        }),
        stdio: "pipe",
      }),
    );
  });
});

describe("CodexAppServerManager", () => {
  test("starts one thread and reuses it across repeated opens", async () => {
    const transport = new FakeTransport();
    const manager = new CodexAppServerManager({
      cwd: "/Users/dan/Documents/InLive",
      createTransport: () => transport,
    });

    const first = manager.open({ codexPath: "/bin/codex" });
    transport.line({ jsonrpc: "2.0", id: (transport.sent[0] as { id: string }).id, result: {} });
    transport.line({ jsonrpc: "2.0", id: (await waitForSent(transport, "thread/start")).id, result: { thread: { id: "thread-1" } } });
    await expect(first).resolves.toMatchObject({ ok: true });

    await expect(manager.open({ codexPath: "/bin/codex" })).resolves.toMatchObject({ ok: true });
    expect(transport.sent.filter((message) => (message as { method?: string }).method === "thread/start")).toHaveLength(1);
  });

  test("restarts the app-server when launch context changes while idle", async () => {
    const transports = [new FakeTransport(), new FakeTransport()];
    const createTransport = vi.fn(() => transports.shift()!);
    const manager = new CodexAppServerManager({
      cwd: "/Users/dan/Documents/InLive",
      createTransport,
    });

    const first = manager.open({ codexPath: "/bin/codex" });
    const firstTransport = createTransport.mock.results[0]!.value as FakeTransport;
    firstTransport.line({ jsonrpc: "2.0", id: (firstTransport.sent[0] as { id: string }).id, result: {} });
    firstTransport.line({ jsonrpc: "2.0", id: (await waitForSent(firstTransport, "thread/start")).id, result: { thread: { id: "thread-1" } } });
    await first;

    const second = manager.open({ codexPath: "/bin/other-codex" });
    const secondTransport = createTransport.mock.results[1]!.value as FakeTransport;
    secondTransport.line({ jsonrpc: "2.0", id: (secondTransport.sent[0] as { id: string }).id, result: {} });
    secondTransport.line({ jsonrpc: "2.0", id: (await waitForSent(secondTransport, "thread/start")).id, result: { thread: { id: "thread-2" } } });
    await expect(second).resolves.toMatchObject({ ok: true });

    expect(createTransport).toHaveBeenCalledTimes(2);
    expect(firstTransport.running).toBe(false);
    expect(manager.snapshot().threadId).toBe("thread-2");
  });

  test("does not reuse stale launch context while a turn is active", async () => {
    const transport = new FakeTransport();
    const manager = new CodexAppServerManager({
      cwd: "/Users/dan/Documents/InLive",
      createTransport: () => transport,
    });
    const opened = manager.open({ codexPath: "/bin/codex" });
    transport.line({ jsonrpc: "2.0", id: (transport.sent[0] as { id: string }).id, result: {} });
    transport.line({ jsonrpc: "2.0", id: (await waitForSent(transport, "thread/start")).id, result: { thread: { id: "thread-1" } } });
    await opened;
    const send = manager.send("hello");
    transport.line({ jsonrpc: "2.0", id: (await waitForSent(transport, "turn/start")).id, result: { turn: { id: "turn-1" } } });
    await send;

    await expect(manager.open({ codexPath: "/bin/other-codex" })).resolves.toEqual({
      ok: false,
      reason: "spawn-failed",
      message: "Codex launch context changed; stop the active turn before restarting Codex.",
    });
    expect(manager.snapshot().messages.at(-1)).toMatchObject({
      role: "system",
      text: "Codex launch context changed; stop the active turn before restarting Codex.",
    });
  });

  test("starts threads with InLive developer instructions and no base/model overrides", async () => {
    const transport = new FakeTransport();
    const manager = new CodexAppServerManager({
      cwd: "/Users/dan/Documents/InLive",
      createTransport: () => transport,
    });

    const opened = manager.open({ codexPath: "/bin/codex" });
    transport.line({ jsonrpc: "2.0", id: (transport.sent[0] as { id: string }).id, result: {} });
    const threadStart = await waitForSent(transport, "thread/start");

    expect(threadStart).toMatchObject({
      params: {
        cwd: "/Users/dan/Documents/InLive",
        developerInstructions: expect.stringContaining("You are running inside InLive"),
        config: {
          shell_environment_policy: {
            inherit: "all",
            include_only: ["PATH", "HOME", "USER", "TMPDIR", "SHELL"],
          },
        },
      },
    });
    expect((threadStart as { params: Record<string, unknown> }).params).not.toHaveProperty("baseInstructions");
    expect((threadStart as { params: Record<string, unknown> }).params).not.toHaveProperty("model");
    expect((threadStart as { params: Record<string, unknown> }).params).not.toHaveProperty("sandbox");

    transport.line({ jsonrpc: "2.0", id: threadStart.id, result: { thread: { id: "thread-1" } } });
    await opened;
  });

  test("maps agent deltas into a reusable chat snapshot", async () => {
    const transport = new FakeTransport();
    const manager = new CodexAppServerManager({ createTransport: () => transport });
    const opened = manager.open({ codexPath: "/bin/codex" });
    transport.line({ jsonrpc: "2.0", id: (transport.sent[0] as { id: string }).id, result: {} });
    transport.line({ jsonrpc: "2.0", id: (await waitForSent(transport, "thread/start")).id, result: { thread: { id: "thread-1" } } });
    await opened;

    const sent = manager.send("hello");
    transport.line({ jsonrpc: "2.0", id: (await waitForSent(transport, "turn/start")).id, result: { turn: { id: "turn-1" } } });
    await sent;
    transport.line({
      jsonrpc: "2.0",
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "agent-1", delta: "Hi" },
    });

    expect(manager.snapshot()).toMatchObject({
      status: "streaming",
      messages: [
        { role: "user", text: "hello" },
        { id: "agent-1", role: "assistant", text: "Hi" },
      ],
    });
  });

  test("surfaces approval requests and sends the selected decision", async () => {
    const transport = new FakeTransport();
    const manager = new CodexAppServerManager({ createTransport: () => transport });
    const opened = manager.open({ codexPath: "/bin/codex" });
    transport.line({ jsonrpc: "2.0", id: (transport.sent[0] as { id: string }).id, result: {} });
    transport.line({ jsonrpc: "2.0", id: (await waitForSent(transport, "thread/start")).id, result: { thread: { id: "thread-1" } } });
    await opened;

    transport.line({
      jsonrpc: "2.0",
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: { command: "pwd", cwd: "/tmp", reason: "test" },
    });
    expect(manager.snapshot().pendingRequests).toMatchObject([{ id: "approval-1", title: "Approve command" }]);

    manager.approve("approval-1", "decline");

    expect(transport.sent.at(-1)).toEqual({ jsonrpc: "2.0", id: "approval-1", result: { decision: "decline" } });
    expect(manager.snapshot().pendingRequests).toEqual([]);
  });

  test("does not spawn when Codex is missing", async () => {
    const createTransport = vi.fn(() => new FakeTransport());
    const manager = new CodexAppServerManager({ createTransport });

    await expect(manager.open({ codexPath: null })).resolves.toEqual({
      ok: false,
      reason: "codex-not-found",
      message: "Codex was not found. Install Codex with npm install -g @openai/codex, then retry.",
    });
    expect(createTransport).not.toHaveBeenCalled();
  });
});
