import { mkdir, readFile, writeFile, copyFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { config } from "dotenv";

config({ path: ".env.petrosoft.local", quiet: true });
const argument = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const base = argument("--base", "http://localhost:3000"), session = argument("--session", ".petrosoft/browser-session.json");
const directory = argument("--out", ".impeccable/review");
const catalog = JSON.parse(await readFile("lib/petrosoft/catalog.json", "utf8"));
const selected = argument("--modules", "").split(",").filter(Boolean);
const targets = selected.length ? catalog.filter(item => selected.includes(item.id)) : catalog;
await mkdir(directory, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ executablePath: process.env.PETROSOFT_CHROME || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-background-networking"] });
const results = [];
let cursor = 0;
const capture = async (page, path) => {
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  // Clipped native selects can inflate Chrome's full-page canvas. Capture the
  // document's scrollable width without changing the viewport or page layout.
  const bounds = await page.evaluate(() => ({
    width: Math.max(innerWidth, document.documentElement.scrollWidth),
    height: Math.max(innerHeight, document.documentElement.scrollHeight, document.body.scrollHeight)
  }));
  const cdp = await page.context().newCDPSession(page);
  try {
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "png", fromSurface: true, captureBeyondViewport: true,
      clip: { x: 0, y: 0, ...bounds, scale: 1 }
    });
    await writeFile(path, Buffer.from(data, "base64"), { mode: 0o600 });
  } finally { await cdp.detach(); }
  return { screenshotWidth: bounds.width, screenshotHeight: bounds.height };
};
try {
  const worker = async () => {
    const context = await browser.newContext({ storageState: session, timezoneId: "Asia/Kolkata", locale: "en-IN" });
    const page = await context.newPage();
    const errors = [], failures = [], remote = [];
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(base).origin || ["data:", "blob:"].includes(url.protocol)) return route.continue();
      remote.push(url.origin + url.pathname); return route.abort();
    });
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => { if (response.status() >= 400) failures.push({ status: response.status(), path: new URL(response.url()).pathname }); });
    while (cursor < targets.length) {
      const target = targets[cursor++];
      for (const [viewport, width, height] of [["desktop", 1600, 1080], ["mobile", 390, 844]]) {
        errors.length = 0; failures.length = 0; remote.length = 0;
        try {
          await page.setViewportSize({ width, height });
          const response = await page.goto(`${base}/api/petrosoft/view/${target.path}`, { waitUntil: "load", timeout: 60000 });
          await page.waitForFunction(() => ["true", "error"].includes(document.body.dataset.psReady), { timeout: 30000 });
          await page.addStyleTag({ content: "*,*::before,*::after{animation-duration:0s!important;transition:none!important}" });
          const screenshot = await capture(page, join(directory, `${target.id}-${viewport}.png`));
          const metrics = await page.evaluate(() => ({ ready: document.body.dataset.psReady, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2, width: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, brokenImages: [...document.images].filter(image => image.complete && !image.naturalWidth).map(image => new URL(image.src).pathname), module: window.PetrosoftRuntime.context.module.id, heading: document.querySelector(".page-title h4,h1,.page-title")?.textContent.trim() || "" }));
          results.push({ module: target.id, viewport, status: response.status(), ...metrics, ...screenshot, errors: [...errors], failures: [...failures], remote: [...remote] });
          const auxiliary = { customers: "vehicles", employees: "employee-benefits", tanks: "nozzles", payroll: "salary-preview", reports: "report-preview", "credit-sales": "sms", "eway-bills": "provider" }[target.id];
          if (auxiliary) {
            await page.evaluate(async ({ module, auxiliary }) => {
              const R = window.PetrosoftRuntime;
              if (auxiliary === "salary-preview") await R.payrollDialog("2026-10");
              else if (auxiliary === "report-preview") await R.openReport(15, { from: "2026-10-01", to: "2026-10-31" });
              else if (auxiliary === "sms") await R.communicationDialog("send_sms", document.querySelector('[data-ps-onclick*="send_sms"]'));
              else if (auxiliary === "provider") { if (!R.state.records.length) return; await R.providerDialog(R.state.records[0], "provider-generate"); }
              else await R.auxDialog(auxiliary, (R.state.masters[module] || [])[0]);
            }, { module: target.id, auxiliary });
            const screenshot = await capture(page, join(directory, `${target.id}-${auxiliary}-${viewport}.png`));
            const metrics = await page.evaluate(() => ({ ready: document.body.dataset.psReady, dialog: document.querySelector('.ps-dialog-backdrop [role="dialog"]')?.getAttribute("aria-labelledby") || "", horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2, brokenImages: [...document.images].filter(image => image.complete && !image.naturalWidth).map(image => new URL(image.src).pathname) }));
            const skipped = auxiliary === "provider" && !metrics.dialog ? "No eligible invoices in this date range." : undefined;
            results.push({ module: target.id, surface: auxiliary, viewport, status: 200, ...metrics, ...screenshot, ...(skipped ? { skipped } : {}), errors: [...errors], failures: [...failures], remote: [...remote] });
            await page.evaluate(() => window.PetrosoftRuntime.closeDialog());
          }
        } catch (error) { results.push({ module: target.id, viewport, error: error.message, errors: [...errors], failures: [...failures], remote: [...remote] }); }
      }
      if (results.length % 20 === 0) console.log(JSON.stringify({ checked: results.length, remaining: (targets.length - cursor) * 2 }));
    }
    await context.close();
  };
  await Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker));
  results.sort((a, b) => a.module.localeCompare(b.module) || a.viewport.localeCompare(b.viewport));
  await writeFile(join(directory, "ui-checks.json"), JSON.stringify(results, null, 2), { mode: 0o600 });
  for (const viewport of ["desktop", "mobile"]) if (targets.some(target => target.id === "dashboard")) await copyFile(join(directory, `dashboard-${viewport}.png`), join(directory, `${viewport}.png`));
  for (const result of results) if (!result.error) await chmod(join(directory, `${result.module}-${result.viewport}.png`), 0o600);
  const issues = results.filter(result => result.error || result.ready !== "true" || result.surface && !result.dialog && !result.skipped || result.horizontalOverflow || result.brokenImages?.length || result.errors?.length || result.failures?.length || result.remote?.length);
  console.log(JSON.stringify({ checked: results.length, issues }));
  if (issues.some(issue => issue.error || issue.ready !== "true" || issue.errors?.length || issue.failures?.some(failure => failure.status >= 500))) process.exitCode = 1;
} finally { await browser.close(); }
