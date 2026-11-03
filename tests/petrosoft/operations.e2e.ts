import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type FrameLocator, type Locator, type Page } from "playwright-core";
import { jsonFields, moduleById } from "../../lib/petrosoft/catalog";
import { station } from "./helpers";

const base = process.env.PETROSOFT_TEST_BASE_URL || "http://localhost:3000";
const output = ".petrosoft/workflow-checks";

async function open(page: Page, frame: FrameLocator, module: string) {
  await page.goto(`${base}/petrosoft/${moduleById.get(module)!.path}`);
  const body = frame.locator('body[data-ps-ready="true"],body[data-ps-ready="error"]');
  await body.waitFor({ timeout: 30000 });
  assert.equal(await body.getAttribute("data-ps-ready"), "true", `${module}: ${await frame.locator(".ps-notice").allTextContents()}`);
  return frame.locator('form[data-ps-form="1"]');
}

async function set(form: Locator, name: string, value: string) {
  let control = form.locator(`[name=${JSON.stringify(name)}]`).first();
  if (await control.evaluate(node => node.tagName === "SELECT")) {
    const offered = await control.evaluate((node, id) => Array.from((node as HTMLSelectElement).options).find(option => option.value === id || option.value.split("|")[0] === id)?.value, value);
    await control.selectOption(offered ?? value, { force: true });
  }
  else if (await control.evaluate(node => (node as HTMLInputElement).type === "radio")) {
    control = form.locator(`[name=${JSON.stringify(name)}][value=${JSON.stringify(value)}]`);
    await control.check({ force: true });
  }
  else await control.fill(value);
  await control.dispatchEvent("change");
}

async function login(page: Page, frame: FrameLocator, code: string) {
  await page.goto(`${base}/petrosoft`);
  await frame.locator('[data-ps-auth="station"] input[type="text"]').fill(code);
  await frame.locator('[data-ps-auth="station"] [type="submit"]').click();
  await page.waitForURL("**/petrosoft/login");
  await frame.locator('[name="username"]').fill("admin");
  await frame.locator('[name="password"]').fill("test-local-password");
  await frame.locator('[data-ps-auth="login"] [type="submit"]').click();
  await page.waitForURL("**/petrosoft/Dashboard");
}

async function edit(frame: FrameLocator, id: string) {
  await frame.locator(`[data-ps-action="edit"][data-ps-record="${id}"]`).click();
  const form = frame.locator(`.ps-dialog form[data-ps-edit="${id}"]`);
  await form.waitFor({ state: "visible" });
  return form;
}

async function save(page: Page, frame: FrameLocator, form: Locator, selector: string, module: string) {
  await form.locator(selector).waitFor({ state: "visible", timeout: 10000 });
  const pending = page.waitForResponse(response => {
    if (new URL(response.url()).pathname !== "/api/petrosoft/action" || response.request().method() !== "POST") return false;
    return response.request().postDataJSON()?.module === module;
  }, { timeout: 15000 });
  await form.locator(selector).click();
  if (await frame.locator("[data-ps-confirm]").count()) await frame.locator("[data-ps-confirm]").click();
  const response = await pending;
  const data = await response.json();
  assert.equal(response.status(), 200, `${module}: ${data.error || "save failed"}`);
  assert.match(data.message, /saved|generated|posted/i);
  await form.locator('[data-ps-busy="1"]').waitFor({ state: "detached" });
  return data;
}

test("operators can save a complete business day through the screens, with persistent stock, customer, employee, bank, and cash balances", { timeout: 240000 }, async () => {
  const s = await station();
  const browser = await chromium.launch({ executablePath: process.env.PETROSOFT_CHROME || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-background-networking"] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1080 }, timezoneId: "Asia/Kolkata" });
  const remote: string[] = [], errors: string[] = [];
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === new URL(base).origin) return route.continue();
    remote.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage(), frame = page.frameLocator("iframe");
  page.on("pageerror", error => errors.push(error.message));
  const steps: { operation: string; amount?: string; quantity?: string }[] = [];
  let stage = "login";
  try {
    await login(page, frame, s.workspace.referenceCode);

    stage = "daily-rates";
    let form = await open(page, frame, stage);
    const rateNames = await form.locator('[name^="new_rate["]').evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).name).sort());
    assert.deepEqual(rateNames, ["new_rate[1]", "new_rate[2]"], "Rate entry must follow the station's products");
    const day = await form.locator('[name="insert_date"]').inputValue();
    for (const [product, rate] of [["1", "100"], ["2", "90"]]) {
      await set(form, `new_rate[${product}]`, rate); await set(form, `cls_rate[${product}]`, rate);
    }
    await save(page, frame, form, 'button[type="submit"]', stage);
    assert.equal(await s.db.petrosoftEntry.count({ where: { workspaceId: s.workspace.id, module: stage } }), 2);
    form = await open(page, frame, stage);
    assert.equal(await form.locator('[name="new_rate[1]"]').inputValue(), "100");
    const rateEntry = await s.db.petrosoftEntry.findFirstOrThrow({ where: { workspaceId: s.workspace.id, module: stage, fields: { path: ["product"], equals: "1" } } });
    for (const closing of ["101", "100"]) {
      form = await edit(frame, rateEntry.id);
      assert.equal(await form.locator('[name^="new_rate["]').count(), 1, "Editing one product must not submit the other rates");
      await set(form, "cls_rate[1]", closing);
      await save(page, frame, form, 'button[type="submit"]', stage);
      assert.equal(jsonFields((await s.entry(rateEntry.id)).fields).cls_rate, closing);
      assert.equal(await s.db.petrosoftEntry.count({ where: { workspaceId: s.workspace.id, module: stage } }), 2);
      form = await open(page, frame, stage);
      assert.equal(await form.locator('[name="cls_rate[1]"]').inputValue(), closing);
    }
    steps.push({ operation: stage });

    stage = "fuel-purchases";
    form = await open(page, frame, stage);
    await set(form, "invo_no", "UI-PURCHASE-1"); await set(form, "liq_vendor", "1");
    await form.locator('[data-target="#tab_3"]').click();
    await form.locator("#tab_3").waitFor({ state: "visible" });
    await set(form, "prod_code[]", "1"); await set(form, "tank_no[]", "T1");
    await set(form, "pro_qty[]", "1000"); await set(form, "purrate[]", "50");
    assert.equal(Number(await form.locator('[name="total_amt"]').inputValue()), 60610, "The displayed invoice total must include configured LFR, VAT, and TCS");
    const purchase = await save(page, frame, form, '#tab_3 button[type="submit"]', stage);
    const purchaseEntry = await s.entry(purchase.entries[0].id);
    assert.equal(purchaseEntry.quantity.toString(), "1000");
    assert.equal(purchaseEntry.amount.toString(), "60610");
    assert.equal((await s.tankStock(s.workspace.id, new Date(day)))[0].fields.close_stock, "1000");
    for (const litres of ["1100", "1000"]) {
      await open(page, frame, stage);
      form = await edit(frame, purchaseEntry.id);
      await form.locator('[data-target="#tab_3"]').click();
      assert.equal(await form.locator('[name="tank_no[]"]').inputValue(), "T1", "Receipt editing must retain its tank allocation");
      await set(form, "pro_qty[]", litres);
      await save(page, frame, form, '#tab_3 button[type="submit"]', stage);
      assert.equal((await s.tankStock(s.workspace.id, new Date(day)))[0].fields.close_stock, litres, "Receipt edits must replace the original stock movement");
    }
    const legacy = await s.submit(stage, { pur_date: day, invo_no: "UI-LEGACY-1", liq_vendor: "1", Payment: "no", rows: [{ prod_code: "1", pro_qty: "5", purrate: "50", purvat: "50", purtcs: "3", lfr: "0", dealercomm: "0", othertxs: "0" }] }) as { entries: { id: string }[] };
    await open(page, frame, stage);
    form = await edit(frame, legacy.entries[0].id);
    await form.locator('[data-target="#tab_3"]').click();
    assert.equal(await form.locator('[name="tank_no[]"]').inputValue(), "", "Legacy receipts must not acquire a tank silently");
    await save(page, frame, form, '#tab_3 button[type="submit"]', stage);
    assert.equal((await s.tankStock(s.workspace.id, new Date(day)))[0].fields.close_stock, "1000");
    await s.action({ module: stage, operation: "delete", id: legacy.entries[0].id });
    steps.push({ operation: stage, amount: "60610", quantity: "1000" });

    stage = "meter-sales";
    form = await open(page, frame, stage);
    await set(form, "close_read_1[]", "100"); await set(form, "noz_emp_1[]", "1");
    const meter = await save(page, frame, form, "#sle_btnSubmit", stage);
    assert.equal((await s.entry(meter.entries[0].id)).amount.toString(), "10000");
    assert.equal((await s.tankStock(s.workspace.id, new Date(day)))[0].fields.close_stock, "900");
    steps.push({ operation: stage, amount: "10000", quantity: "100" });

    stage = "credit-sales";
    form = await open(page, frame, stage);
    await set(form, "organiz[]", "1"); await set(form, "product[]", "1");
    await set(form, "vehi_no[]", "KA01TEST1"); await set(form, "qnty[]", "10");
    await set(form, "indent_no[]", "UI-CREDIT-1"); await set(form, "credsale_emp[]", "1");
    const bill = form.locator('[name="credit_billno[]"]');
    if (!await bill.inputValue() && !await bill.evaluate(node => (node as HTMLInputElement).readOnly)) await bill.fill("UI-CR-1");
    const credit = await save(page, frame, form, "#btn_credit_details", stage);
    for (const litres of ["12", "10"]) {
      await open(page, frame, stage); form = await edit(frame, credit.entries[0].id);
      await set(form, "qnty[]", litres);
      await save(page, frame, form, "#btn_credit_details", stage);
      assert.equal((await s.entry(credit.entries[0].id)).amount.toString(), String(Number(litres) * 100));
    }
    assert.equal((await s.entry(credit.entries[0].id)).amount.toString(), "1000");
    steps.push({ operation: stage, amount: "1000", quantity: "10" });

    stage = "recoveries";
    form = await open(page, frame, stage);
    await set(form, "rec_organiz[]", "1"); await set(form, "paid_amt[]", "500");
    await set(form, "rec_emp[]", "1"); await set(form, "re_type[]", "Cash");
    await save(page, frame, form, "#btn_recovery_details", stage);
    assert.equal((await s.balanceMap(s.workspace.id, new Date(day))).customer["1"].balance, "500");
    steps.push({ operation: stage, amount: "500" });

    stage = "expenses";
    form = await open(page, frame, stage);
    await set(form, "employees[]", "1"); await set(form, "exp_type[]", "1");
    await set(form, "flow[]", "Outflow"); await set(form, "exp_amt[]", "200"); await set(form, "exp_paytype[]", "Cash");
    await save(page, frame, form, "#btn_expens_details", stage);
    assert.equal((await s.balanceMap(s.workspace.id, new Date(day))).cash.cash.balance, "9300");
    steps.push({ operation: stage, amount: "200" });

    stage = "employee-recoveries";
    form = await open(page, frame, stage);
    await set(form, "emp_id[]", "1"); await set(form, "recamnt[]", "9300");
    await save(page, frame, form, "#btn_empcollct_details", stage);
    assert.equal((await s.balanceMap(s.workspace.id, new Date(day))).employee["1"].balance, "0");
    assert.equal((await s.balanceMap(s.workspace.id, new Date(day))).cash.cash.balance, "9300", "Employee collection must not book the cash twice");
    steps.push({ operation: stage, amount: "9300" });

    stage = "settlements";
    form = await open(page, frame, stage);
    await set(form, "outtype[]", "Bank"); await set(form, "handed[]", "1"); await set(form, "hand_amt[]", "9000");
    await save(page, frame, form, "#showModal", stage);
    const balances = await s.balanceMap(s.workspace.id, new Date(day));
    assert.equal(balances.cash.cash.balance, "300"); assert.equal(balances.bank["1"].balance, "9000");
    form = await open(page, frame, stage);
    assert.equal(Number(await form.locator('[name="closecash"]').inputValue()), 300);
    steps.push({ operation: stage, amount: "300" });

    stage = "credit-billing";
    await open(page, frame, "credit-sales");
    await frame.locator(`[data-ps-select="${credit.entries[0].id}"]`).check();
    const invoice = await save(page, frame, frame.locator("body"), '[data-ps-onclick*="add_to_bill("]', "sale-invoices");
    const document = await s.entry(invoice.documents[0].id);
    assert.equal(document.amount.toString(), "1000");
    assert.equal(jsonFields((await s.entry(credit.entries[0].id)).fields).invoice_id, document.id);
    await frame.locator("[data-ps-report-pdf]").waitFor({ state: "visible" });
    const pdf = await context.request.get(`${base}/api/petrosoft/document/${document.id}?format=pdf`);
    assert.equal(pdf.status(), 200); assert.equal((await pdf.body()).subarray(0, 4).toString(), "%PDF");
    const frozen = await context.request.post(`${base}/api/petrosoft/action`, { data: { module: "credit-sales", id: credit.entries[0].id, fields: { qnty: "11" } } });
    assert.equal(frozen.status(), 409, "Billed sales must be protected from edits");
    assert.deepEqual(await s.balanceMap(s.workspace.id, new Date(day)), balances, "Generating an invoice must not book the sale twice");
    steps.push({ operation: stage, amount: "1000" });
    assert.deepEqual(remote, []); assert.deepEqual(errors, []);
    await mkdir(output, { recursive: true, mode: 0o700 });
    await writeFile(`${output}/business-day.json`, JSON.stringify({ checkedAt: new Date().toISOString(), day, steps, closing: { tankLitres: 900, customerDue: 500, employeeDue: 0, bank: 9000, cash: 300 }, errors, remote }, null, 2), { mode: 0o600 });
    await page.screenshot({ path: `${output}/settlement.png` });
  } catch (error) {
    await mkdir(output, { recursive: true, mode: 0o700 });
    await writeFile(`${output}/failure.json`, JSON.stringify({ stage, error: error instanceof Error ? error.message : "Workflow failed", steps, errors, remote }, null, 2), { mode: 0o600 });
    await page.screenshot({ path: `${output}/failure.png` }).catch(() => undefined);
    throw error;
  } finally { await context.close(); await browser.close(); await s.cleanup(); await s.db.$disconnect(); }
});

test("operators can configure a bowser, transfer fuel through receipt and meter dialogs, and record bowser lubricant cash sales", { timeout: 180000 }, async () => {
  const s = await station();
  const browser = await chromium.launch({ executablePath: process.env.PETROSOFT_CHROME || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-background-networking"] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1080 }, timezoneId: "Asia/Kolkata" });
  const remote: string[] = [], errors: string[] = [];
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === new URL(base).origin) return route.continue();
    remote.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage(), frame = page.frameLocator("iframe");
  page.on("pageerror", error => errors.push(error.message));
  let stage = "bowser setup";
  try {
    await s.seed("employees", 2, "Driver", { emp_name: "Driver" });
    await login(page, frame, s.workspace.referenceCode);
    let form = await open(page, frame, "bowser-sales");
    const day = await form.locator('[name="insert_date"]').inputValue();
    await form.locator("[data-ps-add-bowser]").click();
    let dialog = frame.locator('.ps-dialog form[data-ps-module="bowsers"]');
    await set(dialog, "b_name", "UI Delivery Bowser"); await set(dialog, "b_vehicle", "KA01BOWSER1");
    await set(dialog, "capacity", "1000"); await set(dialog, "product", "1");
    await save(page, frame, dialog, 'button[type="submit"]', "bowsers");
    form = await open(page, frame, "bowser-sales"); await set(form, "bowser", "1");
    await form.locator("[data-ps-bowser-nozzles]").click();
    dialog = frame.locator('.ps-dialog form[data-ps-module="bowser-nozzles"]');
    await set(dialog, "nozzle_name", "UI Bowser Nozzle"); await set(dialog, "open_read", "0");
    await save(page, frame, dialog, 'button[type="submit"]', "bowser-nozzles");
    await s.submit("fuel-purchases", { pur_date: day, liq_vendor: "1", invo_no: "BOW-UI-PUR-1", rows: [{ prod_code: "1", tank_no: "T1", pro_qty: "1000", purrate: "50" }] });
    await s.submit("meter-sales", { insert_date: day, product: "1", tank_no: "T1", pump_id: "1", nozzle_id: "1", open_read: "0", close_read: "100", price: "100", employee: "1" });
    stage = "bowser receipt"; form = await open(page, frame, "bowser-sales");
    await set(form, "emp_id", "2"); await set(form, "bowser", "1");
    await form.locator('[data-ps-onclick="showUploadmodel(1)"]').click();
    const receipt = form.locator("#myModal"); await receipt.waitFor({ state: "visible" });
    await set(receipt, "rec_noz[]", "1"); await set(receipt, "rec_qty[]", "50");
    await receipt.locator("#bowreceipt").click(); await receipt.waitFor({ state: "hidden" });
    assert.equal(Number(await form.locator('[name="receipt"]').inputValue()), 50);
    stage = "bowser meter";
    await form.locator('[data-ps-onclick="showUploadmodel(2)"]').click();
    const readings = form.locator("#myModal2"); await readings.waitFor({ state: "visible" });
    await set(readings, "closeread[]", "40");
    assert.equal(Number(await readings.locator('[name="sale_amt[]"]').inputValue()), 4000);
    await readings.locator("#metersalecls").click(); await readings.waitFor({ state: "hidden" });
    assert.equal(Number(await form.locator('[name="closing"]').inputValue()), 10);
    const sale = await save(page, frame, form, "#finlBtn", "bowser-sales");
    let balances = await s.balanceMap(s.workspace.id, new Date(day));
    assert.equal(balances.cash.cash.balance, "9000"); assert.equal(balances.bowser["1"].quantity, "10");
    assert.equal(balances.employee["1"].balance, "5000"); assert.equal(balances.employee["2"].balance, "4000");
    assert.equal((await s.tankStock(s.workspace.id, new Date(day)))[0].fields.close_stock, "900");
    form = await open(page, frame, "bowser-sales");
    form = await edit(frame, sale.entries[0].id);
    assert.equal(Number(await form.locator('[name="rec_qty[]"]').inputValue()), 50);
    assert.equal(Number(await form.locator('[name="closeread[]"]').inputValue()), 40);
    assert.equal(await form.locator('[name="emp_id"]').inputValue(), "2");
    await save(page, frame, form, "#finlBtn", "bowser-sales");
    assert.deepEqual(await s.balanceMap(s.workspace.id, new Date(day)), balances);
    stage = "bowser lubricant cash";
    form = await open(page, frame, "bowser-lubricant-sales");
    await set(form, "Bowser_lub[]", "1"); await set(form, "prodsale_emp[]", "2");
    await set(form, "pro_name2[]", "1"); await set(form, "pro_qty1[]", "2");
    await set(form, "sale_type1[]", "Cash");
    await form.locator('[name="lubvehi_no[]"]').evaluate(node => { (node as HTMLInputElement).value = ""; });
    assert.equal(await form.locator('[name="lubvehi_no[]"]').inputValue(), "");
    await save(page, frame, form, "#btn_lubs_details", "bowser-lubricant-sales");
    balances = await s.balanceMap(s.workspace.id, new Date(day));
    assert.equal(balances.cash.cash.balance, "9400"); assert.equal(balances.employee["2"].balance, "4400");
    stage = "bowser lubricant credit"; form = await open(page, frame, "bowser-lubricant-sales");
    await set(form, "Bowser_lub[]", "1"); await set(form, "prodsale_emp[]", "2");
    await set(form, "pro_name2[]", "1"); await set(form, "pro_qty1[]", "1"); await set(form, "sale_type1[]", "Credit");
    await form.locator('[name="lubvehi_no[]"]').waitFor({ state: "visible" });
    await set(form, "org_name[]", "1"); await set(form, "lubvehi_no[]", "KA01TEST1");
    await save(page, frame, form, "#btn_lubs_details", "bowser-lubricant-sales");
    balances = await s.balanceMap(s.workspace.id, new Date(day));
    assert.equal(balances.cash.cash.balance, "9400"); assert.equal(balances.customer["1"].balance, "200");
    assert.deepEqual(errors, []); assert.deepEqual(remote, []);
    await mkdir(output, { recursive: true, mode: 0o700 });
    await writeFile(`${output}/bowser.json`, JSON.stringify({ checkedAt: new Date().toISOString(), day, stationStock: 900, bowserStock: 10, cash: 9400, stationEmployeeDue: 5000, driverDue: 4400, errors, remote }, null, 2), { mode: 0o600 });
    await open(page, frame, "bowser-sales"); await page.screenshot({ path: `${output}/bowser.png` });
  } catch (error) {
    await mkdir(output, { recursive: true, mode: 0o700 });
    await writeFile(`${output}/bowser-failure.json`, JSON.stringify({ stage, error: error instanceof Error ? error.message : "Workflow failed", errors, remote }, null, 2), { mode: 0o600 });
    await page.screenshot({ path: `${output}/bowser-failure.png` }).catch(() => undefined);
    throw error;
  } finally { await context.close(); await browser.close(); await s.cleanup(); await s.db.$disconnect(); }
});

test("operators can maintain employees and save GST purchases, lubricant sales, and POS collections through their screens", { timeout: 240000 }, async () => {
  const s = await station();
  const browser = await chromium.launch({ executablePath: process.env.PETROSOFT_CHROME || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-background-networking"] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1080 }, timezoneId: "Asia/Kolkata" });
  const errors: string[] = [], remote: string[] = [];
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === new URL(base).origin) return route.continue();
    remote.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage(), frame = page.frameLocator("iframe");
  page.on("pageerror", error => errors.push(error.message));
  let stage = "employees";
  try {
    await login(page, frame, s.workspace.referenceCode);
    let form = await open(page, frame, stage);
    await set(form, "emp_name[]", "UI Operator"); await set(form, "designation[]", "1");
    await set(form, "salary_type[]", "per duty"); await set(form, "salary[]", "500");
    const employee = await save(page, frame, form, '#btnSubmit[type="submit"]', stage);
    assert.equal((await s.entry(employee.entries[0].id)).name, "UI Operator");
    assert.equal(await s.db.petrosoftEntry.count({ where: { workspaceId: s.workspace.id, module: stage } }), 2);

    stage = "expense-types";
    await open(page, frame, "expenses");
    await frame.locator('[data-ps-onclick*="add_exp_type("]').click();
    form = frame.locator('.ps-dialog form[data-ps-module="expense-types"]');
    await set(form, "exp_name[]", "UI Repairs");
    const expenseType = await save(page, frame, form, 'button[type="submit"]', stage);
    assert.equal((await s.entry(expenseType.entries[0].id)).name, "UI Repairs");

    let day = "", paidPurchase = "";
    for (const [module, invoiceNo, litres, total] of [["lubricant-purchases", "UI-OIL-1", "10", 1180], ["other-purchases", "UI-OTHER-1", "2", 236]] as const) {
      stage = module; form = await open(page, frame, stage);
      day = await form.locator('[name="pur_date"]').inputValue();
      await set(form, "invoiceno", invoiceNo); await set(form, "lub_vendor", "1");
      await form.locator('[data-tab="2"]').click();
      await form.locator("#tab_2").waitFor({ state: "visible" });
      await set(form, "pur_proname1[]", "1"); await set(form, "pur_proqty[]", litres); await set(form, "pur_prorate[]", "100");
      assert.equal(Number(await form.locator('[name="invoice_tot"]').inputValue()), total);
      if (module === "lubricant-purchases") {
        await form.locator('label[for="Payment"]').click();
        await form.locator("#paymentdiv").waitFor({ state: "visible" });
        await set(form, "payment_amnt", "500"); await set(form, "payment_bank", "1");
      }
      const purchase = await save(page, frame, form, '#tab_2 #Submit', stage);
      const stored = await s.entry(purchase.entries[0].id);
      assert.equal(stored.amount.toString(), String(total)); assert.equal(jsonFields(stored.fields).invo_no, invoiceNo);
      if (module === "lubricant-purchases") paidPurchase = stored.id;
    }
    let balances = await s.balanceMap(s.workspace.id, new Date(day));
    assert.equal(balances.vendor["1"].balance, "-916"); assert.equal(balances.bank["1"].balance, "-500");
    assert.equal(balances.product["lub:1"].quantity, "10");
    for (const payment of ["600", "500"]) {
      stage = "lubricant-purchases"; await open(page, frame, stage); form = await edit(frame, paidPurchase);
      await form.locator('[data-tab="2"]').click();
      assert.equal((await form.locator('[name="payment_bank"]').inputValue()).split("|")[0], "1", "Editing a paid invoice must retain its bank account");
      await set(form, "payment_amnt", payment);
      await save(page, frame, form, '#tab_2 #Submit', stage);
      balances = await s.balanceMap(s.workspace.id, new Date(day));
      assert.equal(balances.bank["1"].balance, String(-Number(payment))); assert.equal(balances.product["lub:1"].quantity, "10");
    }

    stage = "lubricant-sales"; form = await open(page, frame, stage);
    await set(form, "pro_name2[]", "1"); await set(form, "pro_qty1[]", "2"); await set(form, "prodsale_emp[]", "1");
    await set(form, "sale_type1[]", "Cash");
    const oil = await save(page, frame, form, "#btn_lubs_details", stage);
    assert.equal((await s.entry(oil.entries[0].id)).amount.toString(), "400");
    balances = await s.balanceMap(s.workspace.id, new Date(day));
    assert.equal(balances.cash.cash.balance, "400"); assert.equal(balances.product["lub:1"].quantity, "8");
    for (const count of ["3", "2"]) {
      await open(page, frame, stage); form = await edit(frame, oil.entries[0].id);
      await set(form, "pro_qty1[]", count);
      await save(page, frame, form, "#btn_lubs_details", stage);
      const edited = await s.balanceMap(s.workspace.id, new Date(day));
      assert.equal(edited.cash.cash.balance, String(Number(count) * 200));
      assert.equal(edited.product["lub:1"].quantity, String(10 - Number(count)));
    }
    form = await open(page, frame, stage);
    await set(form, "prodsale_emp[]", "1"); await set(form, "pro_name2[]", "1"); await set(form, "pro_qty1[]", "1"); await set(form, "sale_type1[]", "Cash");
    await form.locator(".pro_field").first().click();
    const rows = form.locator("[data-ps-row]"); assert.equal(await rows.count(), 2);
    await set(rows.nth(1), "prodsale_emp[]", "1"); await set(rows.nth(1), "pro_name2[]", "1"); await set(rows.nth(1), "pro_qty1[]", "1");
    await set(rows.nth(1), "sale_type1[1]", "Credit");
    await rows.nth(1).locator('[id^="org_nme"]').waitFor({ state: "visible" }); await set(rows.nth(1), "org_name[]", "1");
    assert.equal(await rows.nth(0).locator('[name="sale_type1[0]"][value="Cash"]').isChecked(), true);
    const batch = await save(page, frame, form, "#btn_lubs_details", stage);
    assert.equal(batch.entries.length, 2);
    const mixed = await s.balanceMap(s.workspace.id, new Date(day));
    assert.equal(mixed.cash.cash.balance, "600"); assert.equal(mixed.customer["1"].balance, "200"); assert.equal(mixed.product["lub:1"].quantity, "6");
    for (const entry of batch.entries) await s.action({ module: stage, operation: "delete", id: entry.id });

    stage = "swipes"; form = await open(page, frame, stage);
    await set(form, "swipesale_emp[]", "1"); await set(form, "swipe_bank[]", "1"); await set(form, "swipe_amt[]", "150");
    await save(page, frame, form, "#btn_swipe_details", stage);
    balances = await s.balanceMap(s.workspace.id, new Date(day));
    assert.equal(balances.cash.cash.balance, "250"); assert.equal(balances.employee["1"].balance, "250");
    assert.equal(balances.swipe["1"].balance, "150"); assert.deepEqual(errors, []); assert.deepEqual(remote, []);
    await mkdir(output, { recursive: true, mode: 0o700 });
    await writeFile(`${output}/stock-and-pos.json`, JSON.stringify({ checkedAt: new Date().toISOString(), day, employee: "UI Operator", vendorDue: 916, purchasePayment: 500, lubricantStock: 8, cash: 250, pos: 150, errors, remote }, null, 2), { mode: 0o600 });
  } catch (error) {
    await mkdir(output, { recursive: true, mode: 0o700 });
    await writeFile(`${output}/stock-and-pos-failure.json`, JSON.stringify({ stage, error: error instanceof Error ? error.message : "Workflow failed", errors, remote }, null, 2), { mode: 0o600 });
    await page.screenshot({ path: `${output}/stock-and-pos-failure.png` }).catch(() => undefined);
    throw error;
  } finally { await context.close(); await browser.close(); await s.cleanup(); await s.db.$disconnect(); }
});
