import { config } from "dotenv";
import { spawn } from "node:child_process";

config({ path: ".env.bunkbook.local", quiet: true });
process.env.BUNKBOOK_DATABASE_URL ||= "postgresql://bunkbook:bunkbook-local-development@127.0.0.1:54330/bunkbook";
const child = spawn("node", ["node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", process.env.PORT || "3000"], { stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", code => { process.exitCode = code || 0; });
