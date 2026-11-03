import { spawn, spawnSync } from "node:child_process";
import { testEnvironment } from "../tests/support/environment";
import { seedFixtures } from "../tests/support/fixtures";
async function main() {
Object.assign(process.env, testEnvironment);
for (const [command, args] of [
  ["docker", ["compose", "-f", "compose.e2e.yaml", "up", "-d", "--wait"]],
  ["node_modules/.bin/prisma", ["generate"]], ["node_modules/.bin/prisma", ["migrate", "deploy"]],
] as const) {
  const result = spawnSync(command, [...args], { stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}
await seedFixtures(false);
console.log("Local test website: http://localhost:3000. Disposable accounts use LocalPump123!; see tests/.state/fixtures.json.");
const child = spawn("node", ["node_modules/next/dist/bin/next", "dev", "--hostname", "0.0.0.0", "--port", "3000"], { stdio: "inherit", env: process.env });
child.on("exit", code => process.exit(code || 0));

}
main().catch(error => { console.error(error); process.exitCode = 1; });
