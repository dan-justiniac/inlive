import { describe, expect, test } from "vitest";
import { createDevBridgeHandler } from "../src/devBridgeServer";

describe("dev bridge server", () => {
  test("returns a modal URL with a stable WebSocket bridge config", async () => {
    const handler = createDevBridgeHandler({
      viteUrl: "http://127.0.0.1:15173",
      openBridge: async () => ({ ok: true, url: "ws://127.0.0.1:15175", token: "secret" }),
    });

    const response = await handler({ method: "GET", url: "/inlive-dev/modal" });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      modalUrl: "http://127.0.0.1:15173/?bridgeUrl=ws%3A%2F%2F127.0.0.1%3A15175&token=secret",
      width: 520,
      height: 560,
    });
  });

  test("returns an explicit error modal URL when Codex cannot start", async () => {
    const handler = createDevBridgeHandler({
      viteUrl: "http://127.0.0.1:15173",
      openBridge: async () => ({ ok: false, reason: "codex-not-found", message: "Codex missing" }),
    });

    const response = await handler({ method: "GET", url: "/inlive-dev/modal" });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body).modalUrl).toBe("http://127.0.0.1:15173/?error=Codex+missing");
  });
});
