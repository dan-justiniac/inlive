import { runDoctor } from "../src/hostHealth";

const result = await runDoctor();
for (const check of result.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.id}: ${check.message}`);
}
process.exit(result.ok ? 0 : 1);
