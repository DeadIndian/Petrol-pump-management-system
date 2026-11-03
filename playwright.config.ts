import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { testEnvironment } from "./tests/support/environment";
Object.assign(process.env, testEnvironment);
export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: false, workers: 1, retries: 0,
  timeout: 180000, expect: { timeout: 15000 },
  globalSetup: "./tests/global-setup.ts",
  reporter: [["list"], ["html", { open: "never" }], ["json", { outputFile: "test-results/results.json" }]],
  use: { actionTimeout: 15000, navigationTimeout: 30000, baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure", screenshot: "only-on-failure",
    launchOptions: { executablePath: process.env.CHROME_PATH || (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined) } },
  projects: [
    { name: "api", testMatch: "api.spec.ts" },
    { name: "desktop", testMatch: "web.spec.ts", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } } },
    { name: "phone", testMatch: "web.spec.ts", use: { ...devices["Pixel 7"], browserName: "chromium", viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: "node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port 3100",
    url: "http://127.0.0.1:3100/login", reuseExistingServer: false, timeout: 120000,
    env: { ...testEnvironment, NODE_ENV: "production" } },
});
