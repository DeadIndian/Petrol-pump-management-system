import { test, expect, devices, type Browser, type Locator, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";
import { password, readFixtures, type FixtureUser } from "../support/fixtures";
import { assertLocalTestDatabase } from "../support/environment";
import { businessDate } from "../../lib/dates";

const runtimeErrors = new WeakMap<Page, string[]>();
function monitor(page: Page) {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.message));
}
function scope(info: TestInfo) { return readFixtures()[info.project.name as "desktop" | "phone"]; }
async function press(locator: Locator, info: TestInfo) {
  if (info.project.name === "phone") await locator.tap(); else await locator.click();
}
async function rolePage(browser: Browser, info: TestInfo) {
  const context = await browser.newContext({
    ...(info.project.name === "phone" ? devices["Pixel 7"] : {}),
    viewport: info.project.name === "phone" ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    baseURL: "http://127.0.0.1:3100",
  });
  const page = await context.newPage(); monitor(page);
  return { page, context };
}
async function signIn(page: Page, user: FixtureUser, info: TestInfo, secret = password) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(secret);
  await press(page.getByRole("button", { name: "Sign in", exact: true }), info);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    user.role === "ADMIN" ? "Admin Dashboard" : user.role === "EMPLOYEE" ? "Delivery Dashboard" : "Customer Dashboard",
  );
}
async function tab(page: Page, name: string, info: TestInfo) {
  await press(page.getByRole("tab", { name, exact: true }), info);
  await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
}
async function choose(page: Page, label: string, option: string, info: TestInfo) {
  await press(page.getByRole("combobox", { name: label, exact: true }), info);
  await press(page.getByRole("option", { name: option, exact: true }), info);
}
async function expectLayout(page: Page, name: string) {
  const result = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].map(element => {
      const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
    });
    const smallTargets = [...document.querySelectorAll('button, input:not([type="hidden"]), select, a[href]')]
      .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden")
      .map(element => ({ label: element.getAttribute("aria-label") || element.textContent?.trim() || element.id,
        width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }))
      .filter(target => target.width < 43.5 || target.height < 43.5);
    return { width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
      height: innerHeight, dialogs, smallTargets };
  });
  expect(result.scrollWidth, `${name}: horizontal page overflow`).toBeLessThanOrEqual(result.width + 1);
  expect(result.smallTargets, `${name}: touch controls smaller than 44px`).toEqual([]);
  for (const dialog of result.dialogs) {
    expect(dialog.x, `${name}: dialog left`).toBeGreaterThanOrEqual(0);
    expect(dialog.y, `${name}: dialog top`).toBeGreaterThanOrEqual(0);
    expect(dialog.right, `${name}: dialog right`).toBeLessThanOrEqual(result.width + 1);
    expect(dialog.bottom, `${name}: dialog bottom`).toBeLessThanOrEqual(result.height + 1);
  }
}
async function capture(page: Page, info: TestInfo, name: string) {
  mkdirSync(`test-results/screenshots/${info.project.name}`, { recursive: true });
  const path = `test-results/screenshots/${info.project.name}/${name}.png`;
  await page.screenshot({ path, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}
async function placeOrder(page: Page, info: TestInfo, vehicle: string, options: { amount?: number; quantity?: number; cash?: number; fuel?: string; customer?: FixtureUser }) {
  await press(page.getByRole("button", { name: "New order", exact: true }), info);
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  if (options.customer) {
    await dialog.getByLabel("Find a customer").fill(options.customer.email);
    await expect(dialog.getByLabel("Customer", { exact: true }).getByRole("option").filter({ hasText: options.customer.email })).toHaveCount(1);
    await dialog.getByLabel("Customer", { exact: true }).selectOption(options.customer.id);
  }
  await dialog.getByLabel("Vehicle number").fill(vehicle);
  await dialog.getByLabel("Fuel type", { exact: true }).selectOption(options.fuel || "PETROL");
  if (options.amount != null) await dialog.getByLabel("Order by").selectOption("amount");
  await dialog.getByLabel(options.amount != null ? "Fuel amount (₹)" : "Quantity (L)", { exact: true }).fill(String(options.amount ?? options.quantity));
  await dialog.getByLabel("Extra cash (₹)").fill(String(options.cash || 0));
  await expectLayout(page, "order dialog");
  await capture(page, info, "order-form");
  await press(dialog.getByRole("button", { name: "Place order", exact: true }), info);
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText("Order placed");
}
async function complete(page: Page, info: TestInfo, vehicle: string, liters: number) {
  await page.getByLabel("Search orders").fill(vehicle);
  await press(page.getByRole("button", { name: `View order for ${vehicle}`, exact: true }), info);
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  await dialog.getByLabel("Quantity delivered (L)").fill(String(liters));
  await expectLayout(page, "delivery dialog");
  await capture(page, info, "delivery-form");
  await press(dialog.getByRole("button", { name: "Complete delivery", exact: true }), info);
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText("Delivery completed");
}
async function openCustomer(page: Page, info: TestInfo, user: FixtureUser) {
  await tab(page, "Billing", info);
  await page.getByLabel("Search customers").fill(user.email);
  const row = page.getByRole("row").filter({ hasText: user.email });
  await expect(row).toHaveCount(1);
  await press(row.getByRole("button", { name: "View", exact: true }), info);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(user.fullName);
}

test.beforeEach(({ page }) => { monitor(page); });
test.afterEach(({ page }) => { expect(runtimeErrors.get(page) || [], "uncaught browser exceptions").toEqual([]); });

test("public registration, wrong credentials, protected pages and sign out", async ({ page }, info) => {
  await page.goto("/dashboard"); await expect(page).toHaveURL(/\/login$/);
  await page.goto("/admin/login"); await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email", { exact: true }).fill(scope(info).customer.email);
  await page.getByLabel("Password", { exact: true }).fill("Incorrect123!");
  await press(page.getByRole("button", { name: "Sign in", exact: true }), info);
  await expect(page.locator('main [role="alert"]')).toContainText(/invalid|credentials/i);
  await press(page.getByRole("link", { name: "Create an account" }), info);
  const customer: FixtureUser = { id: "", email: `web-signup-${info.project.name}-${Date.now()}@petrol.local`, fullName: "Browser Signup Customer", role: "CUSTOMER" };
  await page.getByLabel("Full name", { exact: true }).fill(customer.fullName);
  await page.getByLabel("Email", { exact: true }).fill(customer.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Phone (optional)").fill("9876543210");
  await expectLayout(page, "registration");
  await press(page.getByRole("button", { name: "Create account", exact: true }), info);
  await expect(page.getByRole("status")).toContainText("Account created");
  await signIn(page, customer, info);
  await expect(page.getByRole("tab", { name: "Users", exact: true })).toHaveCount(0);
  await placeOrderExpectingUnconfiguredRange();
  await tab(page, "My account", info);
  await expect(page.getByText("Not configured", { exact: true })).toBeVisible();
  await expect(page.getByTestId("customer-balance")).toHaveText(/0\.00/);
  await page.reload(); await expect(page.getByRole("heading", { level: 1 })).toHaveText("Customer Dashboard");
  const cookies = await page.context().cookies(); expect(cookies.find(cookie => cookie.name === "auth_token")?.httpOnly).toBe(true);
  await press(page.getByRole("button", { name: "Sign out", exact: true }), info);
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/dashboard"); await expect(page).toHaveURL(/\/login$/);
  async function placeOrderExpectingUnconfiguredRange() {
    await press(page.getByRole("button", { name: "New order", exact: true }), info);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Vehicle number").fill("UNCONFIGURED");
    await dialog.getByLabel("Quantity (L)", { exact: true }).fill("1");
    await press(dialog.getByRole("button", { name: "Place order", exact: true }), info);
    await expect(dialog.getByRole("alert")).toContainText("configure your indent range");
    await press(dialog.getByRole("button", { name: "Close", exact: true }), info);
  }
});

test("customer to employee to admin workflow keeps orders, payments and balances consistent", async ({ page: admin, browser }, info) => {
  const users = scope(info), customer = await rolePage(browser, info), employee = await rolePage(browser, info);
  const vehicle = `WEB-QUANTITY-${info.project.name.toUpperCase()}`;
  const amountVehicle = `WEB-AMOUNT-${info.project.name.toUpperCase()}`;
  const adminVehicle = `WEB-ADMIN-${info.project.name.toUpperCase()}`;
  try {
    await signIn(admin, users.admin, info);
    await tab(admin, "Prices", info);
    for (const [fuel, value] of [["Petrol", 100], ["Diesel", 90]] as const) {
      const card = admin.getByTestId(`fuel-${fuel.toUpperCase()}`); await expect(card).toBeVisible();
      await card.getByLabel(`${fuel} price per litre`, { exact: true }).fill(String(value));
      await press(card.getByRole("button", { name: new RegExp(`(?:Set|Update) ${fuel} price`) }), info);
      await expect(card.getByText(`₹${value.toFixed(2)}`, { exact: true }).first()).toBeVisible();
    }
    // Updating the same day's existing record is also reachable through the browser.
    const petrol = admin.getByTestId("fuel-PETROL");
    await petrol.getByLabel("Petrol price per litre", { exact: true }).fill("101");
    await press(petrol.getByRole("button", { name: "Update Petrol price", exact: true }), info);
    await expect(petrol.getByText("₹101.00", { exact: true }).first()).toBeVisible();
    await petrol.getByLabel("Petrol price per litre", { exact: true }).fill("100");
    await press(petrol.getByRole("button", { name: "Update Petrol price", exact: true }), info);
    await expect(petrol.getByText("₹100.00", { exact: true }).first()).toBeVisible();
    await openCustomer(admin, info, users.customer);
    await press(admin.getByRole("button", { name: "Configure Indent", exact: true }), info);
    const range = admin.getByRole("dialog");
    const start = info.project.name === "phone" ? 6000 : 5000;
    await range.getByLabel("Start Number").fill(String(start));
    await range.getByLabel("End Number").fill(String(start + 100));
    await expectLayout(admin, "indent configuration"); await capture(admin, info, "indent-form");
    await press(range.getByRole("button", { name: "Save Range", exact: true }), info);
    await expect(range).not.toBeVisible();

    await signIn(customer.page, users.customer, info);
    await placeOrder(customer.page, info, vehicle, { quantity: 10, cash: 200 });
    await expect(customer.page.getByRole("row").filter({ hasText: vehicle })).toContainText(`Indent ${start}`);
    await placeOrder(customer.page, info, amountVehicle, { amount: 900, fuel: "DIESEL" });
    await tab(customer.page, "My account", info);
    await expect(customer.page.getByTestId("customer-balance")).toHaveText(/0\.00/);

    await signIn(employee.page, users.employee, info);
    await expect(employee.page.getByRole("button", { name: "New order", exact: true })).toHaveCount(0);
    await complete(employee.page, info, vehicle, 10);
    await tab(employee.page, "My account", info);
    await expect(employee.page.getByText("Completed deliveries", { exact: true }).locator("..")).toContainText("1");
    await expect(employee.page.getByText("Fuel delivered", { exact: true }).locator("..")).toContainText("10 L");
    await press(customer.page.getByRole("button", { name: "Refresh account", exact: true }), info);
    await expect(customer.page.getByTestId("customer-balance")).toHaveText(/1,200\.00/);
    await expect(customer.page.getByText("Amount due", { exact: true })).toBeVisible();

    await press(admin.getByRole("button", { name: "Add Payment", exact: true }), info);
    const payment = admin.getByRole("dialog");
    await payment.getByLabel("Amount (₹) *", { exact: true }).fill("500");
    await choose(admin, "Payment method", "Other", info);
    await payment.getByLabel("Payment Method Note", { exact: true }).fill("Manual voucher");
    await choose(admin, "Payment method", "UPI", info);
    await payment.getByLabel("Reference Number").fill(`WEB-${info.project.name}-500`);
    await payment.getByLabel("Payment Date", { exact: true }).fill(businessDate().toISOString().slice(0, 10));
    await payment.getByLabel("Notes", { exact: true }).fill("End-to-end browser payment");
    await expectLayout(admin, "payment entry"); await capture(admin, info, "payment-form");
    await press(payment.getByRole("button", { name: "Add Payment", exact: true }), info);
    await expect(payment).not.toBeVisible();
    await expect(admin.getByRole("row").filter({ hasText: `WEB-${info.project.name}-500` })).toContainText("500");
    await press(customer.page.getByRole("button", { name: "Refresh account", exact: true }), info);
    await expect(customer.page.getByTestId("customer-balance")).toHaveText(/700\.00/);
    await expect(customer.page.getByRole("row").filter({ hasText: `WEB-${info.project.name}-500` })).toContainText("UPI");
    const paymentRow = admin.getByRole("row").filter({ hasText: `WEB-${info.project.name}-500` });
    admin.once("dialog", dialog => dialog.accept());
    await press(paymentRow.getByRole("button", { name: "Reverse payment", exact: true }), info);
    await expect(paymentRow).toHaveCount(0);
    await press(customer.page.getByRole("button", { name: "Refresh account", exact: true }), info);
    await expect(customer.page.getByTestId("customer-balance")).toHaveText(/1,200\.00/);
    await expect(customer.page.getByText("No payments have been recorded yet.", { exact: true })).toBeVisible();

    await press(admin.getByRole("button", { name: "Back", exact: true }), info);
    await tab(admin, "Orders", info);
    await placeOrder(admin, info, adminVehicle, { quantity: 2, customer: users.customer });
    await complete(admin, info, amountVehicle, 10);
    await complete(admin, info, adminVehicle, 2);
    await press(customer.page.getByRole("button", { name: "Refresh account", exact: true }), info);
    await expect(customer.page.getByTestId("customer-balance")).toHaveText(/2,300\.00/);
    await expect(customer.page.getByText("Completed orders", { exact: true }).locator("..")).toContainText("3");
    await tab(customer.page, "Orders", info);
    await customer.page.getByLabel("Order status", { exact: true }).selectOption("COMPLETED");
    await expect(customer.page.getByRole("row").filter({ hasText: "COMPLETED" })).toHaveCount(3);
    await press(customer.page.getByRole("button", { name: `View order for ${vehicle}`, exact: true }), info);
    await expect(customer.page.getByRole("dialog")).toContainText(users.employee.fullName);
    await expect(customer.page.getByRole("dialog").getByRole("button", { name: "Complete delivery", exact: true })).toHaveCount(0);
    await press(customer.page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }), info);
    await tab(admin, "Employees", info);
    await admin.getByLabel("Search employees").fill(users.employee.email);
    const activity = admin.getByRole("row").filter({ hasText: users.employee.email });
    await expect(activity).toHaveCount(1); await expect(activity).toContainText("10 L"); await expect(activity).toContainText("1,200");
    await expectLayout(admin, "employee activity"); await capture(admin, info, "employee-activity");
    expect(runtimeErrors.get(customer.page)).toEqual([]); expect(runtimeErrors.get(employee.page)).toEqual([]);
  } finally { await customer.context.close(); await employee.context.close(); }
});

test("admin creates staff, edits roles and passwords, and deletes empty accounts through the browser", async ({ page, browser }, info) => {
  await signIn(page, scope(info).admin, info); await tab(page, "Users", info);
  const managed: FixtureUser = { id: "", email: `managed-${info.project.name}-${Date.now()}@petrol.local`, fullName: "Managed Browser Employee", role: "EMPLOYEE" };
  await press(page.getByRole("button", { name: "Add User", exact: true }), info);
  const create = page.getByRole("dialog");
  await create.getByLabel("Full Name *", { exact: true }).fill(managed.fullName);
  await create.getByLabel("Email *", { exact: true }).fill(managed.email);
  await create.getByLabel("Password *", { exact: true }).fill(password);
  await create.getByLabel("Phone", { exact: true }).fill("9876543210");
  await expectLayout(page, "create user"); await capture(page, info, "create-user-form");
  await press(create.getByRole("button", { name: "Create User", exact: true }), info); await expect(create).not.toBeVisible();
  await page.getByLabel("Search users").fill(managed.email);
  await expect(page.getByRole("row").filter({ hasText: managed.email })).toHaveCount(1);
  const employee = await rolePage(browser, info);
  try { await signIn(employee.page, managed, info); await tab(employee.page, "My account", info); await expect(employee.page.getByText("Completed deliveries", { exact: true }).locator("..")).toContainText("0"); }
  finally { await employee.context.close(); }
  await press(page.getByRole("button", { name: `Edit ${managed.fullName}`, exact: true }), info);
  const edit = page.getByRole("dialog");
  await edit.getByLabel("Full Name", { exact: true }).fill("Updated Browser Customer");
  await edit.getByLabel("Phone", { exact: true }).fill("9123456789");
  await edit.getByLabel(/New Password/).fill("ChangedPump123!");
  await choose(page, "User role", "Customer", info);
  await expectLayout(page, "edit user"); await capture(page, info, "edit-user-form");
  await press(edit.getByRole("button", { name: "Save Changes", exact: true }), info); await expect(edit).not.toBeVisible();
  const customer = await rolePage(browser, info);
  try {
    await customer.page.goto("/login"); await customer.page.getByLabel("Email", { exact: true }).fill(managed.email);
    await customer.page.getByLabel("Password", { exact: true }).fill(password);
    await press(customer.page.getByRole("button", { name: "Sign in", exact: true }), info);
    await expect(customer.page.locator('main [role="alert"]')).toContainText(/credentials|invalid/i);
    await signIn(customer.page, { ...managed, role: "CUSTOMER" }, info, "ChangedPump123!");
    await tab(customer.page, "My account", info);
    await expect(customer.page.getByTestId("customer-balance")).toHaveText(/0\.00/);
    await expect(customer.page.getByText("9123456789", { exact: true })).toBeVisible();
    await page.getByLabel("Filter users by role").selectOption("CUSTOMER");
    const row = page.getByRole("row").filter({ hasText: managed.email }); await expect(row).toHaveCount(1);
    page.once("dialog", dialog => dialog.accept());
    await press(row.getByRole("button", { name: "Delete Updated Browser Customer", exact: true }), info);
    await expect(row).toHaveCount(0);
    await customer.page.goto("/dashboard"); await expect(customer.page).toHaveURL(/\/login/);
    expect(runtimeErrors.get(customer.page)).toEqual([]);
  } finally { await customer.context.close(); }
});

test("history pagination, search and date filters work without hiding older records", async ({ page: admin, browser }, info) => {
  const users = scope(info); await signIn(admin, users.admin, info);
  const customer = await rolePage(browser, info); const prisma = new PrismaClient(); assertLocalTestDatabase();
  try {
    const start = info.project.name === "phone" ? 11000 : 10000;
    expect((await admin.request.post(`/api/admin/users/${users.other.id}/indent`, { data: { indentStart: start, indentEnd: start + 100 } })).status()).toBe(200);
    const profile = await prisma.customerProfile.findUniqueOrThrow({ where: { userId: users.other.id } });
    for (let index = 0; index < 21; index++) {
      expect((await admin.request.post("/api/orders", { data: { customerId: users.other.id, vehicleNumber: `${info.project.name.toUpperCase()}-PAGE-${String(index).padStart(2, "0")}`, fuelType: "PETROL", quantityRequested: 1 } })).status()).toBe(201);
      expect((await admin.request.post("/api/bills", { data: { customerProfileId: profile.id, amount: 1, paymentMethod: "CASH", reference: `${info.project.name}-history-${index}` } })).status()).toBe(201);
    }
    const today = businessDate();
    await prisma.fuelPrice.createMany({ data: Array.from({ length: 23 }, (_, index) => ({ fuelType: "PETROL" as const, pricePerLiter: 99,
      date: new Date(today.getTime() - (index + 1) * 86400000), createdByAdminId: users.admin.id })), skipDuplicates: true });
    await signIn(customer.page, users.other, info);
    await expect(customer.page.getByRole("row")).toHaveCount(21); // Header plus 20 records.
    await press(customer.page.getByRole("button", { name: "Next", exact: true }), info);
    await expect(customer.page.getByRole("row")).toHaveCount(2);
    await customer.page.getByLabel("Search orders").fill(`${info.project.name.toUpperCase()}-PAGE-00`);
    await expect(customer.page.getByRole("row")).toHaveCount(2);
    await expect(customer.page.getByRole("row").last()).toContainText("PAGE-00");
    await customer.page.getByLabel("Order status", { exact: true }).selectOption("COMPLETED");
    await expect(customer.page.getByText("0 matching orders", { exact: true })).toBeVisible();
    await tab(customer.page, "My account", info);
    await expect(customer.page.getByText("21 payments", { exact: true })).toBeVisible();
    await press(customer.page.getByRole("button", { name: "Next payments", exact: true }), info);
    await expect(customer.page.getByRole("row")).toHaveCount(2);
    await press(customer.page.getByRole("button", { name: "Previous payments", exact: true }), info);
    await expect(customer.page.getByRole("row")).toHaveCount(21);
    await tab(customer.page, "Prices", info);
    await expect(customer.page.getByText(/24 price records|23 price records/)).toBeVisible();
    await press(customer.page.getByRole("button", { name: "Next prices", exact: true }), info);
    await expect(customer.page.getByRole("row")).toHaveCount(5);
    await press(customer.page.getByRole("button", { name: "Previous prices", exact: true }), info);
    await expect(customer.page.getByRole("row")).toHaveCount(21);
    await customer.page.getByLabel("Fuel type", { exact: true }).selectOption("DIESEL");
    await expect(customer.page.getByRole("button", { name: "Previous prices", exact: true })).toBeDisabled();

    await openCustomer(admin, info, users.other);
    const tables = admin.getByRole("table"); await expect(tables).toHaveCount(2);
    await expect(tables.first().getByRole("row")).toHaveCount(21);
    await press(admin.getByRole("button", { name: "Next orders", exact: true }), info);
    await expect(tables.first().getByRole("row")).toHaveCount(2);
    const day = today.toISOString().slice(0, 10);
    await admin.getByLabel("Start Date", { exact: true }).fill(day); await admin.getByLabel("End Date", { exact: true }).fill(day);
    await expect(tables.first().getByRole("row")).toHaveCount(21);
    await choose(admin, "Vehicle filter", `${info.project.name.toUpperCase()}-PAGE-00`, info);
    await expect(tables.first().getByRole("row")).toHaveCount(2);
    await choose(admin, "Order status filter", "Completed", info);
    await expect(tables.first().getByRole("row")).toHaveCount(1);
    await press(admin.getByRole("button", { name: "Next payments", exact: true }), info);
    await expect(tables.last().getByRole("row")).toHaveCount(2);
    await press(admin.getByRole("button", { name: "Previous payments", exact: true }), info);
    await expect(tables.last().getByRole("row")).toHaveCount(21);
    await expectLayout(admin, "customer history"); await capture(admin, info, "customer-history");

    await press(admin.getByRole("button", { name: "Back", exact: true }), info);
    await tab(admin, "Users", info);
    const listing = await (await admin.request.get("/api/admin/users?limit=1")).json();
    for (let index = listing.pagination.total; index < 22; index++) {
      expect((await admin.request.post("/api/admin/users", { data: { email: `directory-${info.project.name}-${index}-${Date.now()}@petrol.local`, fullName: `Directory Employee ${index}`, password, role: "EMPLOYEE" } })).status()).toBe(201);
    }
    await press(admin.getByRole("button", { name: "Refresh", exact: true }), info);
    await expect(admin.getByRole("button", { name: "Next users", exact: true })).toBeEnabled();
    const first = await admin.getByRole("row").nth(1).innerText();
    await press(admin.getByRole("button", { name: "Next users", exact: true }), info);
    await expect(admin.getByRole("row").nth(1)).not.toHaveText(first);
    await admin.getByLabel("Search users").fill(users.admin.email);
    await expect(admin.getByRole("row")).toHaveCount(2);
    await expect(admin.getByRole("row").last()).toContainText(users.admin.fullName);
    expect(runtimeErrors.get(customer.page)).toEqual([]);
  } finally { await customer.context.close(); await prisma.$disconnect(); }
});

test("expired browser sessions recover and role restrictions survive direct URLs", async ({ page, browser }, info) => {
  const users = scope(info); await signIn(page, users.customer, info);
  const token = (await page.context().cookies()).find(cookie => cookie.name === "auth_token")!;
  await page.context().addCookies([{ ...token, value: "expired" }]);
  await page.goto("/dashboard"); await expect(page.getByRole("heading", { level: 1 })).toHaveText("Customer Dashboard");
  await page.context().addCookies([{ ...token, value: "expired-again" }]);
  await tab(page, "Prices", info);
  await expect(page.getByText("Price history", { exact: true })).toBeVisible();
  await expect(page.locator('main [role="alert"]')).toHaveCount(0);
  const cookies = await page.context().cookies(); expect(cookies.find(cookie => cookie.name === "auth_token")?.value).not.toBe("expired-again");
  expect((await page.request.get("/api/admin/users")).status()).toBe(403);
  expect((await page.request.post(`/api/admin/users/${users.customer.id}/indent`, { data: { indentStart: 1, indentEnd: 10 } })).status()).toBe(403);
  await page.goto(`/dashboard/customers/${users.other.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Customer Dashboard");
  const employee = await rolePage(browser, info);
  try {
    await signIn(employee.page, users.employee, info);
    expect((await employee.page.request.get("/api/bills")).status()).toBe(403);
    await employee.page.goto(`/dashboard/customers/${users.customer.id}`);
    await expect(employee.page.getByRole("heading", { level: 1 })).toHaveText("Delivery Dashboard");
    await press(employee.page.getByRole("button", { name: "Sign out", exact: true }), info);
    await expect(employee.page).toHaveURL(/\/login$/);
  } finally { await employee.context.close(); }
  await page.route("**/api/orders?**", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary test outage" }) }));
  await tab(page, "Orders", info);
  await press(page.getByRole("button", { name: "Refresh orders", exact: true }), info);
  await expect(page.locator('main [role="alert"]')).toContainText("Temporary test outage");
  await page.unroute("**/api/orders?**"); await press(page.getByRole("button", { name: "Refresh orders", exact: true }), info);
  await expect(page.locator('main [role="alert"]')).toHaveCount(0);
  await page.context().addCookies([{ ...token, value: "expired" }, { name: "refresh_token", value: "invalid-refresh", url: "http://127.0.0.1:3100", httpOnly: true }]);
  await page.goto("/dashboard"); await expect(page).toHaveURL(/\/login\?expired=1$/);
});

test("all web sections meet accessibility, viewport and touch-target checks", async ({ page }, info) => {
  test.setTimeout(240000);
  const violations: { surface: string; rules: unknown[] }[] = [];
  async function inspect(surface: string, screenshot = true) {
    await expectLayout(page, surface);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    if (result.violations.length) violations.push({ surface, rules: result.violations.map(row => ({ id: row.id, impact: row.impact, nodes: row.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) })) });
    if (screenshot) await capture(page, info, surface);
  }
  await page.goto("/login"); await inspect("login");
  await page.goto("/signup"); await inspect("signup");
  await signIn(page, scope(info).admin, info);
  for (const name of ["Overview", "Orders", "Prices", "Billing", "Employees", "Users"]) {
    await tab(page, name, info);
    const refresh = page.getByRole("button", { name: /^Refresh/ }).first();
    await expect(refresh).toBeEnabled();
    await inspect(`admin-${name.toLowerCase()}`);
  }
  await openCustomer(page, info, scope(info).customer); await inspect("admin-customer");
  await press(page.getByRole("button", { name: "Add Payment", exact: true }), info); await inspect("admin-payment-dialog");
  await press(page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }), info);
  await press(page.getByRole("button", { name: "Configure Indent", exact: true }), info); await inspect("admin-indent-dialog");
  await press(page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }), info);
  await signIn(page, scope(info).customer, info);
  for (const name of ["Orders", "Prices", "My account"]) { await tab(page, name, info); await expect(page.getByRole("button", { name: /^Refresh/ }).first()).toBeEnabled(); await inspect(`customer-${name.toLowerCase().replace(/ /g, "-")}`); }
  await tab(page, "Orders", info); await press(page.getByRole("button", { name: "New order", exact: true }), info); await inspect("customer-order-dialog");
  await press(page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }), info);
  const sizes = info.project.name === "phone" ? [{ width: 320, height: 740 }, { width: 844, height: 390 }] : [{ width: 768, height: 1024 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await inspect(`customer-orders-${size.width}`, false);
    await press(page.getByRole("button", { name: "New order", exact: true }), info);
    await expectLayout(page, `order dialog at ${size.width}x${size.height}`);
    await capture(page, info, `order-dialog-${size.width}`);
    await press(page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }), info);
    await signIn(page, scope(info).admin, info);
    for (const name of ["Overview", "Orders", "Prices", "Billing", "Users"]) { await tab(page, name, info); await expect(page.getByRole("button", { name: /^Refresh/ }).first()).toBeEnabled(); await inspect(`admin-${name.toLowerCase()}-${size.width}`, false); }
    await openCustomer(page, info, scope(info).customer);
    await press(page.getByRole("button", { name: "Add Payment", exact: true }), info);
    await expectLayout(page, `payment dialog at ${size.width}x${size.height}`);
    await press(page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }), info);
    await signIn(page, scope(info).customer, info);
  }
  await page.setViewportSize(info.project.name === "phone" ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  await signIn(page, scope(info).employee, info);
  for (const name of ["Orders", "Prices", "My account"]) { await tab(page, name, info); await inspect(`employee-${name.toLowerCase().replace(/ /g, "-")}`); }
  await info.attach("accessibility-results", { body: JSON.stringify(violations, null, 2), contentType: "application/json" });
  expect(violations.map(row => ({ surface: row.surface, rules: row.rules })), "WCAG automated accessibility violations").toEqual([]);
});
