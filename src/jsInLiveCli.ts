import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extensionStatusPath } from "./extensionStatus";
import type { JsRunnerRequest, JsRunnerResponse, JsRunnerValue } from "./jsRunner";

export interface RunnerConfig {
  url: string;
  token: string;
}

export function buildRunnerRequest(argv: string[]): JsRunnerRequest {
  let code: string | null = null;
  let filename: string | undefined;
  const args: Record<string, unknown> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === "-e" || value === "--eval") {
      code = argv[++index] ?? fail("Missing value after --eval.");
    } else if (value === "--arg") {
      Object.assign(args, parseArg(argv[++index] ?? fail("Missing value after --arg.")));
    } else if (value.startsWith("-")) {
      fail(`Unknown option ${value}.`);
    } else if (!filename) {
      filename = resolve(value);
      code = readFileSync(filename, "utf8");
    } else {
      fail(`Unexpected argument ${value}.`);
    }
  }
  if (!code) fail("Provide JavaScript with --eval or a file path.");
  return Object.keys(args).length ? { code, filename, args } : { code, filename };
}

export function readRunnerConfig(statusPath = extensionStatusPath): RunnerConfig {
  const status = JSON.parse(readFileSync(statusPath, "utf8")) as { jsRunner?: RunnerConfig };
  if (!status.jsRunner?.url || !status.jsRunner.token) {
    fail(`InLive JS runner is not available in ${statusPath}. Start npm run live:dev and wait for activation.`);
  }
  return { url: status.jsRunner.url, token: status.jsRunner.token };
}

export async function runCli(argv = process.argv.slice(2), output = process.stdout, statusPath = extensionStatusPath) {
  const request = buildRunnerRequest(argv);
  const config = readRunnerConfig(statusPath);
  const response = await fetch(config.url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-inlive-token": config.token },
    body: JSON.stringify(request),
  });
  if (!response.ok) fail(`InLive JS runner returned HTTP ${response.status}: ${await response.text()}`);
  const text = formatRunnerResponse(await response.json() as JsRunnerResponse);
  if (text) output.write(`${text}\n`);
}

export function formatRunnerResponse(response: JsRunnerResponse) {
  const logs = response.logs.map((log) => log.text);
  if (!response.ok) {
    throw new Error([...logs, response.error.stack ?? response.error.message].join("\n"));
  }
  const result = formatResult(response.result);
  return [...logs, result].filter(Boolean).join("\n");
}

function formatResult(result: JsRunnerValue) {
  if (result.kind === "undefined") return "";
  if (result.kind === "text") return result.value;
  return JSON.stringify(result.value);
}

function parseArg(value: string) {
  const split = value.indexOf("=");
  if (split <= 0) fail("--arg expects name=value.");
  const name = value.slice(0, split);
  const raw = value.slice(split + 1);
  try {
    return { [name]: JSON.parse(raw) };
  } catch {
    return { [name]: raw };
  }
}

function fail(message: string): never {
  throw new Error(message);
}
