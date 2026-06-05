import { describe, expect, test, vi } from "vitest";
import { chatHtml } from "../src/webview";

vi.mock("chat-client-source", () => ({ default: "/* chat client */" }));
vi.mock("chat-css-source", () => ({ default: "body { color: white; }" }));

describe("chatHtml", () => {
  test("renders a compact closable chat modal shell", () => {
    const html = chatHtml({
      title: "InLive Codex",
      chat: { url: "ws://127.0.0.1:1234", token: "secret" },
    });

    expect(html).toContain('id="transcript"');
    expect(html).toContain('id="composer"');
    expect(html).toContain('id="closeButton"');
    expect(html).toContain('aria-label="Close InLive Codex chat"');
    expect(html).toContain("window.inliveChat");
    expect(html).toContain("InLive Codex");
  });
});
