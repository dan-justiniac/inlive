import { spawnSync } from "node:child_process";
import {
  clearExtensionStatus,
  defaultLivePath,
  ensureDevBridgeHealthy,
  spawnLiveDevHost,
  stopInLiveHosts,
  waitForActivation,
} from "../src/hostHealth";

const cwd = process.cwd();
await ensureDevBridgeHealthy();

const build = spawnSync("./node_modules/.bin/tsx", ["build.ts"], { cwd, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const killed = await stopInLiveHosts({ cwd });
if (killed.length) console.log(`Stopped stale InLive ExtensionHost process(es): ${killed.join(", ")}`);
clearExtensionStatus();

const child = spawnLiveDevHost(cwd, process.env.INLIVE_LIVE_PATH ?? defaultLivePath);
try {
  const status = await waitForActivation();
  console.log(`InLive ExtensionHost ready: pid=${status.pid}, registered=${status.registeredScopes}/${status.expectedScopes}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  child.kill("SIGTERM");
  process.exit(1);
}

child.on("exit", (code) => process.exit(code ?? 0));
