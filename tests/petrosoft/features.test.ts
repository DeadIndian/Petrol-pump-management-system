import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { jsonFields } from "../../lib/petrosoft/catalog";
import { ids, runtime, station } from "./helpers";

after(async () => { const api = await runtime(); await api.db.$disconnect(); });

test("master child edits keep their identities, replace omitted children, and protect assigned nozzles", async () => {
  const s = await station();
  try {
    const customer = await s.db.petrosoftEntry.findFirstOrThrow({ where: { workspaceId: s.workspace.id, module: "customers" } });
    await s.submit("customers", { vehicle_no: ["KA01TEST1", "KA01TEST2"], vehicle_place: ["Depot", "Shop"], pd_prod_id: ["1"], pd_disc_offer: ["1"], replace_children: true }, customer.id);
    const first = await s.db.petrosoftEntry.findMany({ where: { workspaceId: s.workspace.id, module: "vehicles", status: "active" } });
    await s.submit("customers", { vehicle_no: ["KA01TEST1"], vehicle_place: ["Updated Depot"], pd_prod_id: ["1"], pd_disc_offer: ["2"], replace_children: true }, customer.id);
    const remaining = await s.db.petrosoftEntry.findMany({ where: { workspaceId: s.workspace.id, module: "vehicles", status: "active" } });
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, first.find(entry => entry.name === "KA01TEST1")!.id);
    assert.equal(jsonFields(remaining[0].fields).vehicle_place, "Updated Depot");
    const discounts = await s.db.petrosoftEntry.findMany({ where: { workspaceId: s.workspace.id, module: "customer-discounts", status: "active" } });
    assert.equal(discounts.length, 1); assert.equal(jsonFields(discounts[0].fields).disc_offer, "2");
    const tank = await s.db.petrosoftEntry.findFirstOrThrow({ where: { workspaceId: s.workspace.id, module: "tanks" } });
    await s.submit("tanks", { nozzel: ["Renamed N1"], nozzel_id: ["1"], pro_name: "1", replace_children: true }, tank.id);
    assert.equal((await s.db.petrosoftEntry.findFirstOrThrow({ where: { workspaceId: s.workspace.id, module: "nozzles", externalId: "1" } })).name, "Renamed N1");
    await assert.rejects(s.submit("tanks", { nozzel: ["Unassigned N2"], nozzel_id: [""], replace_children: true }, tank.id), /cannot be removed/);
    assert.equal(await s.db.petrosoftEntry.count({ where: { workspaceId: s.workspace.id, module: "nozzles", status: "active" } }), 1);
  } finally { await s.cleanup(); }
});

test("attachments verify their bytes and enforce module permissions and station ownership", async () => {
  const s = await station(), other = await station(), directory = await mkdtemp(join(tmpdir(), "petrosoft-test-uploads-"));
  const previous = process.env.PETROSOFT_STORAGE; process.env.PETROSOFT_STORAGE = directory;
  try {
    const { uploadAttachment, readAttachment } = await import("../../lib/petrosoft/attachments");
    const bytes = await readFile("public/petrosoft-assets/assets/images/noz.png");
    const attachment = await uploadAttachment({ ...s.actor, permissions: ["customers:create", "customers:view"] }, new File([bytes], "nozzle.png"), "customers");
    assert.deepEqual(Buffer.from((await readAttachment(s.actor, attachment.id)).bytes), bytes);
    await assert.rejects(readAttachment(other.actor, attachment.id), /not found/);
    await assert.rejects(readAttachment({ ...s.actor, permissions: ["dashboard:view"] }, attachment.id), /cannot open/);
    await assert.rejects(uploadAttachment({ ...s.actor, permissions: ["customers:view"] }, new File([bytes], "nozzle.png"), "customers"), /cannot upload/);
    await assert.rejects(uploadAttachment(s.actor, new File(["invalid PNG"], "bad.png"), "customers"), /does not match/);
  } finally { if (previous === undefined) delete process.env.PETROSOFT_STORAGE; else process.env.PETROSOFT_STORAGE = previous; await s.cleanup(); await other.cleanup(); await rm(directory, { recursive: true, force: true }); }
});

test("CSV import previews without writing and rolls back the whole batch on a duplicate", async () => {
  const s = await station();
  try {
    const { previewImport, commitImport } = await import("../../lib/petrosoft/imports");
    const before = await s.db.petrosoftEntry.count({ where: { workspaceId: s.workspace.id, module: "customers" } });
    const file = new File(["Registered Date,Organization Name,Cust/Represent Name\n01/01/2026,Imported Customer,Imported Contact\n"], "customers.csv", { type: "text/csv" });
    const preview = await previewImport(s.actor, file, "customers", "");
    assert.equal(preview.errors.length, 0); assert.equal(preview.rows[0].org_name, "Imported Customer"); assert.equal(preview.rows[0].insert_date, "2026-01-01");
    assert.equal(await s.db.petrosoftEntry.count({ where: { workspaceId: s.workspace.id, module: "customers" } }), before);
    await commitImport(s.actor, preview.module, preview.rows, preview.formIndex);
    assert.equal(await s.db.petrosoftEntry.count({ where: { workspaceId: s.workspace.id, module: "customers" } }), before + 1);
    await assert.rejects(commitImport(s.actor, "customers", [{ ...preview.rows[0], org_name: "Atomic New Customer" }, preview.rows[0]], preview.formIndex), /already exists|already recorded|duplicate/i);
    assert.equal(await s.db.petrosoftEntry.count({ where: { workspaceId: s.workspace.id, name: "Atomic New Customer" } }), 0);
    await assert.rejects(previewImport({ ...s.actor, permissions: ["customers:view"] }, file, "customers", ""), /cannot import/);
  } finally { await s.cleanup(); }
});

test("provider requests use a local mock, preserve government references, and protect invoices across failures", async () => {
  const s = await station(), other = await station();
  const calls: { body: Record<string, unknown>; authorization?: string; key?: string }[] = [];
  let rejectCancel = false, rejectGenerate = false;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.ok(body.station.code.startsWith("TEST-PETROSOFT-"));
      calls.push({ body, authorization: request.headers.authorization, key: request.headers["idempotency-key"] as string | undefined });
      response.setHeader("Content-Type", "application/json");
      if (rejectCancel && body.operation === "cancel" || rejectGenerate && body.operation === "generate") { response.statusCode = 502; response.end(JSON.stringify({ error: "Mock provider failure" })); return; }
      response.end(JSON.stringify(body.service === "bpcl" ? { rows: [{ date: "2026-01-01", vehicle: "KA01TEST1", product: "MS", amount: "100", refno: "MOCK-1" }] } : { reference: "MOCK-DOCUMENT-1", status: body.operation === "cancel" ? "cancelled" : "generated", AckNo: "MOCK-ACK" }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const previous = Object.fromEntries(["SMS", "EMAIL", "WHATSAPP", "EINVOICE", "EWAY", "BIOMETRIC", "BPCL"].flatMap(service => ["URL", "KEY"].map(suffix => { const key = `PETROSOFT_${service}_${suffix}`; return [key, process.env[key]]; })));
  for (const service of ["SMS", "EMAIL", "WHATSAPP", "EINVOICE", "EWAY", "BIOMETRIC", "BPCL"]) { process.env[`PETROSOFT_${service}_URL`] = `http://127.0.0.1:${address.port}`; process.env[`PETROSOFT_${service}_KEY`] = "local-test-only"; }
  try {
    const { governmentDocument, sendCommunication, requestIntegration } = await import("../../lib/petrosoft/integrations");
    await sendCommunication(s.actor, "sms", { to: "9999999999", message: "Local mock message", module: "credit-sales" });
    await sendCommunication(s.actor, "email", { to: "test@example.invalid", message: "Local mock message", module: "recoveries" });
    await assert.rejects(sendCommunication(s.actor, "sms", { to: "invalid", message: "Message" }), /valid mobile/);
    await assert.rejects(requestIntegration({ ...s.actor, permissions: ["reports:view"] }, "bpcl", "transactions", {}), /cannot use/);
    const sale = ids(await s.submit("credit-sales", { insert_date: "2026-01-01", organiz: "1", product: "1", price: "100", qnty: "1", credsale_emp: "1" }))[0];
    const generated = await s.action({ module: "sale-invoices", operation: "generate", ids: [sale], fields: { invoice_date: "2026-01-01" } }) as { documents: { id: string }[] };
    const id = generated.documents[0].id;
    await assert.rejects(governmentDocument(other.actor, "einvoice", "generate", id, {}), /from this station/);
    rejectGenerate = true; await assert.rejects(governmentDocument(s.actor, "einvoice", "generate", id, {}), /Mock provider failure/);
    await assert.rejects(s.action({ module: "generated-invoices", operation: "delete", id }), /government document/);
    rejectGenerate = false;
    const issued = await governmentDocument(s.actor, "einvoice", "generate", id, {});
    assert.equal(issued.reference, "MOCK-DOCUMENT-1");
    assert.equal(calls.filter(call => call.body.service === "einvoice" && call.body.operation === "generate")[0].key, calls.filter(call => call.body.service === "einvoice" && call.body.operation === "generate")[1].key);
    await assert.rejects(governmentDocument(s.actor, "einvoice", "generate", id, {}), /already generated/);
    rejectCancel = true; await assert.rejects(governmentDocument(s.actor, "einvoice", "cancel", id, { reason: "Local test reversal" }), /Mock provider failure/);
    assert.equal(jsonFields(jsonFields(jsonFields((await s.entry(id)).fields).integrations).einvoice).status, "generated");
    rejectCancel = false; await governmentDocument(s.actor, "einvoice", "cancel", id, { reason: "Local test reversal" });
    await s.action({ module: "generated-invoices", operation: "delete", id });
    assert.equal(jsonFields((await s.entry(sale)).fields).invoice_id, undefined);
    const { buildReport } = await import("../../lib/petrosoft/report-data");
    assert.equal((await buildReport(s.actor, 91, { from: "2026-01-01", to: "2026-01-01", data_source: "api" })).sections[0].rows.length, 1);
    const token = randomUUID();
    await s.db.petrosoftSession.create({ data: { tokenHash: s.digest(token), userId: s.actor.id, expiresAt: new Date(Date.now() + 60000) } });
    const { POST, GET } = await import("../../app/api/petrosoft/integration/route");
    const response = await POST(new NextRequest("http://localhost:3000/api/petrosoft/integration", { method: "POST", headers: { cookie: `petrosoft_session=${token}`, origin: "http://localhost:3000", host: "localhost:3000", "Content-Type": "application/json" }, body: JSON.stringify({ type: "biometric", operation: "employees" }) }));
    assert.equal(response.status, 200); assert.equal((calls.at(-1)!.body.payload as { employees: unknown[] }).employees.length, 1);
    const configuration = await GET(new NextRequest("http://localhost:3000/api/petrosoft/integration", { headers: { cookie: `petrosoft_session=${token}` } }));
    assert.equal(configuration.status, 200); assert.ok(!(await configuration.text()).includes("local-test-only"));
    assert.ok(calls.every(call => call.authorization === "Bearer local-test-only"));
  } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await s.cleanup(); await other.cleanup(); }
});

test("FIFO consumes earlier sales, Tally exports project ledger fields, and dashboard filters use real movements", async () => {
  const s = await station();
  try {
    const { buildReport } = await import("../../lib/petrosoft/report-data"), { reportCell } = await import("../../lib/petrosoft/report-render");
    for (const [date, rate, invoice] of [["2026-01-01", "60", "FIFO-1"], ["2026-02-01", "80", "FIFO-2"]]) await s.submit("fuel-purchases", { pur_date: date, invo_no: invoice, liq_vendor: "1", Payment: "no", rows: [{ prod_code: "1", pro_qty: "10", purrate: rate, purvat: "0", purtcs: "0", lfr: "0", dealercomm: "0", tank_no: "T1" }] });
    await s.submit("meter-sales", { insert_date: "2026-01-02", product: "1", tank_no: "T1", nozzle_id: "1", pump_id: "1", employee: "1", open_read: "0", close_read: "10", price: "100" });
    await s.submit("meter-sales", { insert_date: "2026-02-02", product: "1", tank_no: "T1", nozzle_id: "1", pump_id: "1", employee: "1", open_read: "10", close_read: "15", price: "100" });
    await s.submit("recoveries", { insert_date: "2026-02-02", rec_organiz: "1", rec_emp: "1", paid_amt: "100", re_type: "Bank", banktype_field: "1" });
    const fifo = await buildReport(s.actor, 34, { from: "2026-02-01", to: "2026-02-28", gross_type: "Liquids", product: "1" });
    assert.equal(fifo.sections[0].rows[0].purchaserate, "80"); assert.equal(fifo.sections[0].rows[0].gain, "100");
    const audit = await buildReport(s.actor, 59, { from: "2026-02-01", to: "2026-02-28" });
    assert.equal(audit.sections[0].rows.length, 1); assert.equal(reportCell(audit.sections[0].rows[0], "Sales Ledger", 0), "Sales Ledger");
    const products = await buildReport(s.actor, 13, { from: "2026-02-01", to: "2026-02-28" });
    assert.equal(reportCell(products.sections[0].rows[0], "Under", 0), "Primary");
    const state = await s.readState(s.actor, "dashboard", { date: "2026-02-02", dashboard_product: "1", stock_month: "2026-01" });
    assert.deepEqual(state.bankFlow?.map(row => row.debit), ["100"]);
    assert.deepEqual(state.monthlyTrends?.map(row => row.sale), ["10", "5"]);
    assert.equal(state.stockMonth, "2026-01");
  } finally { await s.cleanup(); }
});

test("location stock carries earlier transfers into opening quantities without double counting station inventory", async () => {
  const s = await station();
  try {
    await s.seed("godowns", 1, "Warehouse", {});
    const stock = await s.seed("lubricant-purchases", 1, "Opening Oil", { product: "1" });
    await s.db.petrosoftLedger.create({ data: { entryId: stock.id, date: new Date("2025-12-01"), entityType: "product", entityId: "lub:1", quantity: "100" } });
    for (const [number, date, quantity, from, to] of [[1, "2025-12-02", "20", "0", "1"], [2, "2026-01-02", "5", "1", "0"]] as const) { const entry = await s.seed("godown-transfers", number, "Transfer", { product: "1", from_location: from, to_location: to }, date); await s.db.petrosoftEntry.update({ where: { id: entry.id }, data: { quantity } }); }
    const { buildReport } = await import("../../lib/petrosoft/report-data");
    const report = await buildReport(s.actor, 89, { from: "2026-01-01", to: "2026-01-31" });
    const rows = report.sections[0].rows;
    assert.equal(rows.find(row => row.location_id === "1")!.openingstock, "20"); assert.equal(rows.find(row => row.location_id === "1")!.closingstock, "15");
    assert.equal(rows.find(row => row.location_id === "0")!.closingstock, "85");
    assert.equal(rows.reduce((total, row) => total + Number(row.closingstock), 0), 100);
  } finally { await s.cleanup(); }
});
