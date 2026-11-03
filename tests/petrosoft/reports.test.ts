import assert from "node:assert/strict";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { ids, runtime, station } from "./helpers";

after(async () => { const api = await runtime(); await api.db.$disconnect(); });

test("reports reconcile customer periods, daily stock, filter arrays, and complete business sections", async () => {
  const s = await station();
  const { buildReport } = await import("../../lib/petrosoft/report-data");
  try {
    await s.submit("opening-stock", { insert_date: "2026-05-01", tank_no: "T1", open_stock: "1000", dip_stock: "1000" });
    await s.submit("meter-sales", { insert_date: "2026-05-01", product: "1", tank_no: "T1", pump_id: "1", nozzle_id: "1", open_read: "0", close_read: "102", test_qty: "2", price: "100", employee: "1" });
    await s.submit("credit-sales", { insert_date: "2026-05-01", organiz: "1", product: "1", qnty: "10", price: "100", credsale_emp: "1" });
    await s.submit("recoveries", { insert_date: "2026-05-02", rec_organiz: "1", rec_emp: "1", re_type: "Cash", paid_amt: "400" });
    const report = await buildReport(s.actor, 15, { frm_dt: "2026-05-02", to_dt: "2026-05-02", credit_org: "1", credit_category: "unassigned-category" });
    assert.deepEqual(Object.fromEntries(["openingbalance", "collectable", "recovery", "closingbalance"].map(key => [key, report.sections[0].rows[0][key]])), { openingbalance: "1000", collectable: "0", recovery: "400", closingbalance: "600" });
    const dsr = await buildReport(s.actor, 71, { frm_dt: "2026-05-01", to_dt: "2026-05-02", dsr: "productwise", "prodc[]": ["1"], "tank[]": ["a-different-tank"] });
    assert.equal(dsr.sections[0].rows.length, 2);
    assert.equal(dsr.sections[0].rows[0].netmetersale, "100");
    assert.equal(dsr.sections[0].rows[0].testing, "2");
    assert.equal(dsr.sections[0].rows[1].openstock, "900");
    const oneDay = await buildReport(s.actor, 29, { rdate: "2026-05-02" });
    assert.equal(oneDay.from, "2026-05-02");
    assert.equal(oneDay.to, "2026-05-02");
    assert.equal((await buildReport(s.actor, 32, { from: "2026-05-01", to: "2026-05-02" })).sections.length, 12);
    assert.equal((await buildReport(s.actor, 36, { from: "2026-05-01", to: "2026-05-02" })).sections.length, 8);
    const actor = { ...s.actor, permissions: ["reports:view", "reports:report-15"] };
    await buildReport(actor, 15, { from: "2026-05-01", to: "2026-05-02" });
    await assert.rejects(buildReport(actor, 26, { from: "2026-05-01", to: "2026-05-02" }), /cannot open this report/);
  } finally { await s.cleanup(); }
});

test("report exports contain real values, escape user content, create valid PDFs, and enforce export permissions", async () => {
  const s = await station();
  const [{ reportCsv, reportHtml, reportPdf, reportXlsx }, { POST }] = await Promise.all([import("../../lib/petrosoft/report-render"), import("../../app/api/petrosoft/export/route")]);
  try {
    const report = { title: "Export verification", from: "2026-05-01", to: "2026-05-01", format: "html", sections: [{ title: "Values", columns: ["Customer", "Amount", "Description"], rows: [{ customer: "<script>alert(1)</script>", amount: "125.5", description: "=HYPERLINK(\"https://invalid.example\")" }], totals: { customer: "Total", amount: "125.5" } }] };
    assert.ok(reportHtml(report, s.actor).includes("&lt;script&gt;"));
    assert.ok(!reportHtml(report, s.actor).includes("<script>alert"));
    assert.ok(reportCsv(report).includes("'=HYPERLINK"));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await reportXlsx(report)) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    assert.equal(workbook.worksheets[0].getCell("B2").value, 125.5);
    assert.equal(workbook.worksheets[0].getCell("B3").value, 125.5);
    assert.equal(workbook.worksheets[0].getCell("C2").type, ExcelJS.ValueType.String);
    assert.equal(Buffer.from(await reportPdf(report, s.actor)).subarray(0, 5).toString(), "%PDF-");
    const limited = await s.db.petrosoftUser.create({ data: { workspaceId: s.workspace.id, username: "report-reader", fullName: "Reader", role: "Reader", passwordHash: s.hashPassword("test-only"), permissions: ["reports:view", "reports:report-15"] } });
    const token = "local-report-export-verification";
    await s.db.petrosoftSession.create({ data: { userId: limited.id, tokenHash: s.digest(token), expiresAt: new Date(Date.now() + 60000) } });
    const response = await POST(new NextRequest("http://localhost:3000/api/petrosoft/export", { method: "POST", headers: { cookie: `petrosoft_session=${token}`, "content-type": "application/json" }, body: JSON.stringify({ index: 15, fields: { from: "2026-05-01", to: "2026-05-01" }, format: "csv" }) }));
    assert.equal(response.status, 403);
  } finally { await s.cleanup(); }
});

test("all report definitions render with an isolated station and explicit empty states", async () => {
  const s = await station();
  const [{ buildReport, reportSpecs }, { projectedReport, reportHtml }] = await Promise.all([import("../../lib/petrosoft/report-data"), import("../../lib/petrosoft/report-render")]);
  try {
    for (const spec of reportSpecs) {
      const report = await buildReport(s.actor, spec.index, { from: "2026-05-01", to: "2026-05-02" });
      assert.ok(report.sections.length, `Report ${spec.index} has no sections`);
      for (const section of projectedReport(report).sections) for (const cells of section.cells) assert.equal(cells.length, section.columns.length);
      assert.ok(reportHtml(report, s.actor).includes("<table"), `Report ${spec.index} has no table`);
    }
  } finally { await s.cleanup(); }
});

test("loyalty earnings, gift inventory, and redemptions remain consistent through edits and reversal", async () => {
  const s = await station();
  try {
    await s.seed("loyalty-points", 1, "Regular", { tier_name: "Regular", product: "1", prod_id: "1", points_rate: "2" });
    await s.seed("gifts", 1, "Gift", { emp_name: "Gift", emp_no: "10", points: "10" });
    const sale = ids(await s.submit("guest-sales", { insert_date: "2026-06-01", gname: "Test Guest", mobileno: "9000000000", product: "1", price: "100", qnty: "10", cost: "1000", sale_emp: "1", coll_type: "Cash" }))[0];
    const giftPurchase = ids(await s.submit("gift-purchases", { insert_date: "2026-06-01", vend: "1", gname: "1", qty: "2", price: "10", cost: "20" }))[0];
    const fields = (await s.entry(sale)).fields as { guest_id: string };
    const redemption = ids(await s.submit("gift-sales", { insert_date: "2026-06-02", guest_cust: fields.guest_id, gifts: "1" }))[0];
    const balances = await s.balanceMap(s.workspace.id, new Date("2026-06-30"));
    assert.equal(balances.loyalty[fields.guest_id].quantity, "10");
    assert.equal(balances.product["gift:1"].quantity, "1");
    await assert.rejects(s.action({ module: "guest-sales", operation: "delete", id: sale }), /gift redemptions/);
    await assert.rejects(s.action({ module: "gift-purchases", operation: "delete", id: giftPurchase }), /issued gifts/);
    await assert.rejects(s.submit("gift-sales", { insert_date: "2026-06-02", guest_cust: fields.guest_id, gifts: "1", rows: [{ guest_cust: fields.guest_id, gifts: "1" }, { guest_cust: fields.guest_id, gifts: "1" }] }), /enough points/);
    await s.action({ module: "gift-sales", operation: "delete", id: redemption });
    await s.action({ module: "guest-sales", operation: "delete", id: sale });
    await s.action({ module: "gift-purchases", operation: "delete", id: giftPurchase });
    const final = await s.balanceMap(s.workspace.id, new Date("2026-06-30"));
    assert.equal(final.loyalty?.[fields.guest_id]?.quantity || "0", "0");
    assert.equal(final.product?.["gift:1"]?.quantity || "0", "0");
  } finally { await s.cleanup(); }
});
