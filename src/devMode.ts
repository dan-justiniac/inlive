export const defaultDevServerUrl = "http://127.0.0.1:15173";
export const defaultDevBridgeUrl = "http://127.0.0.1:15174";
export const defaultDevWebSocketPort = 15175;
export const defaultJsRunnerPort = 15176;

export interface BridgeConfig {
  url: string;
  token: string;
}

export function resolveDevServerUrl(env: Record<string, string | undefined> = process.env) {
  const explicit = env.INLIVE_DEV_SERVER_URL?.trim();
  if (explicit) return trimTrailingSlash(explicit);
  return env.INLIVE_DEV === "1" ? defaultDevServerUrl : null;
}

export function buildDevModalEndpoint(devServerUrl: string) {
  return `${trimTrailingSlash(devServerUrl)}/inlive-dev/modal`;
}

export function buildDevModalUrl(viteUrl: string, bridge: BridgeConfig) {
  const url = new URL(trimTrailingSlash(viteUrl) + "/");
  url.searchParams.set("bridgeUrl", bridge.url);
  url.searchParams.set("token", bridge.token);
  return url.toString();
}

export function buildDevErrorModalUrl(viteUrl: string, error: string) {
  const url = new URL(trimTrailingSlash(viteUrl) + "/");
  url.searchParams.set("error", error);
  return url.toString();
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
