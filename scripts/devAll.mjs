import { spawn } from "node:child_process";

const children = [
  spawn("npm", ["run", "dev"], { stdio: "inherit" }),
  spawn("npm", ["run", "live:dev"], { stdio: "inherit" }),
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
