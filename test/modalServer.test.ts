import { afterEach, describe, expect, test } from "vitest";
import { ModalServer } from "../src/modalServer";

const servers: ModalServer[] = [];

afterEach(() => {
  while (servers.length) servers.pop()!.close();
});

describe("ModalServer", () => {
  test("serves registered HTML over localhost", async () => {
    const server = new ModalServer();
    servers.push(server);

    const url = await server.addPage("<!doctype html><title>InLive</title>");
    const response = await fetch(url);

    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]+$/);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    await expect(response.text()).resolves.toBe("<!doctype html><title>InLive</title>");
  });

  test("fails explicitly for unknown page ids", async () => {
    const server = new ModalServer();
    servers.push(server);

    const url = await server.addPage("<!doctype html>");
    const response = await fetch(url.replace(/[^/]+$/, "missing"));

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("InLive modal page not found.");
  });
});
