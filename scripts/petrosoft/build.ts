import { config } from "dotenv";
import { spawn } from "node:child_process";

config({ path: ".env.petrosoft.local", quiet: true });
const child = spawn("node", ["node_modules/next/dist/bin/next", "build"], { stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", code => { process.exitCode = code || 0; });
