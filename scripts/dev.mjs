import { spawn } from "node:child_process";

const bin = (name) => new URL(`../node_modules/.bin/${name}`, import.meta.url).pathname;
const children = [
  spawn(bin("vite"), ["--host", "127.0.0.1"], { stdio: "inherit" }),
  spawn(bin("tsx"), ["watch", "src/devBridgeMain.ts"], {
    stdio: "inherit",
    env: {
      ...process.env,
      INLIVE_DEV_SERVER_URL: process.env.INLIVE_DEV_SERVER_URL ?? "http://127.0.0.1:15173",
      INLIVE_DEV_BRIDGE_URL: process.env.INLIVE_DEV_BRIDGE_URL ?? "http://127.0.0.1:15174",
      INLIVE_DEV_WS_PORT: process.env.INLIVE_DEV_WS_PORT ?? "15175",
    },
  }),
];

let exiting = false;
for (const child of children) {
  child.on("exit", (code, signal) => {
    if (exiting) return;
    exiting = true;
    for (const other of children) {
      if (other !== child && !other.killed) other.kill("SIGTERM");
    }
    process.exit(code ?? (signal ? 1 : 0));
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    exiting = true;
    for (const child of children) child.kill(signal);
  });
}
