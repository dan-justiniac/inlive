import { runCli } from "./jsInLiveCli";

runCli().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
