import { spawn } from "node:child_process";
import { testEnvironment } from "../tests/support/environment";
async function run(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: { ...process.env, ...testEnvironment, NEXT_TELEMETRY_DISABLED: "1" } });
    child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}
async function main() {
await run("docker", ["compose", "-f", "compose.e2e.yaml", "up", "-d", "--wait"]);
await run("node_modules/.bin/prisma", ["generate"]);
await run("node_modules/.bin/prisma", ["migrate", "deploy"]);
await run("npm", ["run", "typecheck"]);
await run("npm", ["run", "lint"]);
await run("npm", ["run", "build"]);
await run("npm", ["run", "test:e2e"]);
console.log("Web verification passed. Test services remain available; npm run test:stack:down removes only their disposable data.");

}
main().catch(error => { console.error(error); process.exitCode = 1; });
