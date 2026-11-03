import { config } from "dotenv";
import { spawn } from "node:child_process";
config({ path: ".env.petrosoft.local", quiet: true });
process.env.PETROSOFT_DATABASE_URL ||= "postgresql://petrosoft:petrosoft-local-development@127.0.0.1:54330/petrosoft";
const child = spawn("node", ["node_modules/next/dist/bin/next", "dev", "--hostname", "0.0.0.0", "--port", process.env.PORT || "3000"], { stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", code => { process.exitCode = code || 0; });
