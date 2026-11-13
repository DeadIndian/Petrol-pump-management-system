// Runs the browser workflow tests against a throwaway server that uses the dedicated *_test
// database, never the real station. Usage: npm run test:bunkbook:browser
import { spawn, spawnSync } from "node:child_process";
import { prepareTestDatabase, testDatabaseUrl } from "../../tests/bunkbook/helpers";

const port = process.env.BUNKBOOK_TEST_PORT || "3100";
const base = `http://localhost:${port}`;

async function main() {
  await prepareTestDatabase();
  const server = spawn("node", ["node_modules/next/dist/bin/next", "dev", "--port", port], {
    stdio: "ignore", env: { ...process.env, BUNKBOOK_DATABASE_URL: testDatabaseUrl, BUNKBOOK_NEXT_DIST_DIR: ".bunkbook/builds/browser-test" },
  });
  try {
    for (let attempt = 0; ; attempt++) {
      if (attempt > 90) throw new Error("The test server did not start.");
      if (await fetch(`${base}/bunkbook/login`).then(response => response.ok, () => false)) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const result = spawnSync("node_modules/.bin/tsx", ["--test", "--test-concurrency=1", "tests/bunkbook/operations.e2e.ts"], {
      stdio: "inherit", env: { ...process.env, BUNKBOOK_TEST_BASE_URL: base },
    });
    process.exitCode = result.status ?? 1;
  } finally { server.kill("SIGTERM"); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
