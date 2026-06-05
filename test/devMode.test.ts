import { describe, expect, test } from "vitest";
import { buildDevModalEndpoint, buildDevModalUrl, resolveDevServerUrl } from "../src/devMode";

describe("dev mode", () => {
  test("stays in production when dev mode is unset", () => {
    expect(resolveDevServerUrl({})).toBeNull();
  });

  test("uses the explicit dev server URL", () => {
    expect(resolveDevServerUrl({ INLIVE_DEV_SERVER_URL: "http://127.0.0.1:15173/" })).toBe("http://127.0.0.1:15173");
  });

  test("uses the default Vite URL when INLIVE_DEV is enabled", () => {
    expect(resolveDevServerUrl({ INLIVE_DEV: "1" })).toBe("http://127.0.0.1:15173");
  });

  test("builds the bootstrap modal endpoint from the dev server URL", () => {
    expect(buildDevModalEndpoint("http://127.0.0.1:15173")).toBe("http://127.0.0.1:15173/inlive-dev/modal");
  });

  test("builds a dev modal URL that carries the bridge config", () => {
    const modalUrl = new URL(buildDevModalUrl("http://127.0.0.1:15173", {
      url: "ws://127.0.0.1:15175",
      token: "abc",
    }));

    expect(`${modalUrl.origin}${modalUrl.pathname}`).toBe("http://127.0.0.1:15173/");
    expect(modalUrl.searchParams.get("bridgeUrl")).toBe("ws://127.0.0.1:15175");
    expect(modalUrl.searchParams.get("token")).toBe("abc");
  });
});
