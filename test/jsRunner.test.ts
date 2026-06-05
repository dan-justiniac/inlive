import { afterEach, describe, expect, test } from "vitest";
import { JsRunnerServer, type JsRunnerRequest } from "../src/jsRunner";

let servers: JsRunnerServer[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  servers = [];
});

describe("JS runner", () => {
  test("runs async JavaScript with captured console output and injected Live context", async () => {
    const server = await startRunner();
    const response = await run(server, {
      code: "console.log('track', live.name); return await Promise.resolve(args.value + 1);",
      args: { value: 41 },
    });

    expect(response).toMatchObject({
      ok: true,
      result: { kind: "json", value: 42 },
      logs: [{ level: "log", text: "track Session" }],
    });
    expect(response.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("returns explicit execution errors with captured logs", async () => {
    const server = await startRunner();
    const response = await run(server, {
      code: "console.warn('before'); throw new Error('boom');",
    });

    expect(response).toMatchObject({
      ok: false,
      error: { message: "boom" },
      logs: [{ level: "warn", text: "before" }],
    });
    expect(response.error?.stack).toContain("Error: boom");
  });

  test("rejects missing or wrong tokens", async () => {
    const server = await startRunner();
    const response = await fetch(server.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-inlive-token": "wrong" },
      body: JSON.stringify({ code: "return 1;" }),
    });

    expect(response.status).toBe(401);
    expect(await response.text()).toContain("Invalid InLive JS runner token");
  });

  test("exposes a health endpoint", async () => {
    const server = await startRunner();
    const response = await fetch(`${server.origin}/health`, {
      headers: { "x-inlive-token": server.token },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });
});

async function startRunner() {
  const server = new JsRunnerServer({
    live: { name: "Session" },
    sdk: { version: "test" },
    port: 0,
    token: "secret",
  });
  servers.push(server);
  await server.start();
  return server;
}

async function run(server: JsRunnerServer, request: JsRunnerRequest) {
  const response = await fetch(server.url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-inlive-token": server.token },
    body: JSON.stringify(request),
  });
  expect(response.status).toBe(200);
  return response.json() as ReturnType<JsRunnerServer["run"]> extends Promise<infer Result> ? Result : never;
}
