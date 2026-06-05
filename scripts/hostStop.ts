import { stopInLiveHosts } from "../src/hostHealth";

const killed = await stopInLiveHosts({ cwd: process.cwd() });
if (killed.length) console.log(`Stopped InLive ExtensionHost process(es): ${killed.join(", ")}`);
else console.log("No InLive ExtensionHost processes were running.");
