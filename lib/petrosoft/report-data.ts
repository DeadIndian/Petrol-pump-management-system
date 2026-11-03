import type { PetrosoftActor } from "./auth";
import { hasPermission } from "./auth";
import { fieldNumber, fieldValue, jsonFields, type PetrosoftFields } from "./catalog";
import { PetrosoftError } from "./actions";
import { petrosoftDb } from "./db";
import { balanceMap, dailySummary, dateRange, displayNames, latestRates, mastersFor, serializeEntry, tankStock, transactionRecords, type PublicEntry } from "./queries";
import { baseModule, CUSTOMER_KEYS, EMPLOYEE_KEYS, money, PRODUCT_KEYS, quantity, VENDOR_KEYS } from "./rules";
import reportCatalog from "./reports.json";

export type ReportRow = Record<string, unknown>;
export interface ReportSection { title: string; columns: string[]; rows: ReportRow[] }
export interface ReportResult { title: string; from: string; to: string; sections: ReportSection[]; format: string; summary?: ReportRow }
const reportSpecs = reportCatalog as { index: number; title: string; action: string; format: string; tables: { headers: string[]; class: string }[] }[];
const transactionModules = ["meter-sales", "credit-sales", "recoveries", "lubricant-sales", "swipes", "expenses", "employee-recoveries", "fuel-purchases", "lubricant-purchases", "other-purchases", "lfr-invoices", "settlements", "opening-stock", "business-transactions", "vendor-transactions", "swipe-settlements", "attendance-details", "guest-sales", "gift-purchases", "gift-sales", "handling-loss", "lubricant-loss", "interest", "bowser-sales", "bowser-credit-sales", "bowser-recoveries", "bowser-swipes", "bowser-expenses", "bowser-lubricant-sales", "feedback", "pump-incentives", "godown-transfers"];
const source = (entry: PublicEntry) => entry.fields as PetrosoftFields;
const sum = (rows: PublicEntry[], key: "amount" | "quantity" = "amount") => rows.reduce((total, row) => total.add(row[key]), money(0));
function add(row: ReportRow, key: string, amount: unknown) { row[key] = money(row[key] || 0).add(money(amount || 0)).toString(); }
function group(rows: ReportRow[], key: (row: ReportRow) => string, measures: string[]) {
  const groups = new Map<string, ReportRow>();
  for (const row of rows) {
    const id = key(row), existing = groups.get(id) || { ...row };
    if (!groups.has(id)) for (const measure of measures) existing[measure] = "0";
    for (const measure of measures) add(existing, measure, row[measure]);
    groups.set(id, existing);
  }
  return [...groups.values()];
}
function rowFor(entry: PublicEntry): ReportRow {
  const f = source(entry);
  return { ...f, id: entry.id, module: entry.module, date: entry.date, name: entry.name, number: entry.number, refno: fieldValue(f, ["credit_billno", "billno", "bill_no", "invo_no", "invoiceno", "invoice", "ref_no"], String(entry.number)),
    product: fieldValue(f, "product_name"), product_id: fieldValue(f, PRODUCT_KEYS), customer_id: fieldValue(f, CUSTOMER_KEYS), customer: fieldValue(f, "organization_name"), employee: fieldValue(f, "employee_name"), employee_id: fieldValue(f, EMPLOYEE_KEYS), vendor: fieldValue(f, "vendor_name"), vendor_id: fieldValue(f, VENDOR_KEYS), vehicle: fieldValue(f, ["vehi_no", "vehicle_no", "lubvehi_no"]),
    quantity: entry.quantity, price: entry.rate, amount: entry.amount, total: fieldValue(f, "total_amount", entry.amount), discount: fieldValue(f, ["discount", "credit_discnt", "disc_amt", "rec_disc_amt"], "0"), misccharges: fieldValue(f, ["misc_charges", "batta_amt", "batta"], "0"), description: fieldValue(f, ["desc", "descript", "description", "rec_desc", "swipe_des", "lubdesc", "emprec_desc", "trans_desc", "hand_des"]),
    mode: fieldValue(f, ["re_type", "exp_paytype", "sale_type1", "sale_type", "collection_mode", "coll_type"], "Cash"), type: fieldValue(f, ["sale_type1", "sale_type", "flow", "trans_type"]),
  };
}

export async function buildReport(actor: PetrosoftActor, index: number, input: PetrosoftFields = {}): Promise<ReportResult> {
  if (!hasPermission(actor, "reports")) throw new PetrosoftError("Your role cannot open reports.", 403);
  const spec = reportSpecs.find(report => report.index === index);
  if (!spec) throw new PetrosoftError("Choose a valid report.", 404);
  const fields = { ...input,
    from: fieldValue(input, ["from", "frm_dt", "from_dt", "purfrm_dt", "swp_frm_dt", "dt", "credit_dt", "recov_dt"]),
    to: fieldValue(input, ["to", "to_dt", "purto_dt", "swp_to_dt", "dt2", "one_dt", "rdate", "bowsr_date"]),
  };
  const range = dateRange(fields, false), from = range.from.toISOString().slice(0, 10), to = range.to.toISOString().slice(0, 10);
  const [masters, closing, opening, rates, original] = await Promise.all([
    mastersFor(actor.workspaceId), balanceMap(actor.workspaceId, range.to), balanceMap(actor.workspaceId, new Date(range.from.getTime() - 86400000)),
    latestRates(actor.workspaceId, range.to), transactionRecords(actor.workspaceId, transactionModules, { from, to }, false),
  ]);
  const records = original.map(entry => displayNames(entry, masters, closing));
  const name = (module: string, id: string) => (masters[module] || []).find(row => row.externalId === id.split("|")[0] || row.id === id)?.name || id;
  const customerId = fieldValue(input, ["credit_org", "customer_id", "organiz", "org_id"]);
  const employeeId = fieldValue(input, ["emp_id", "emp_name", "day_emp", "emp_idI"]);
  const vendorId = fieldValue(input, ["Vendor", "vend_name", "vendor_id"]);
  const category = fieldValue(input, "credit_category");
  const allowedCustomers = (masters.customers || []).filter(customer => (!customerId || customerId === "all" || customerId === "All" || customer.externalId === customerId) && (!category || /all/i.test(category) || fieldValue(customer.fields as PetrosoftFields, ["cust_category", "category"]) === category));
  const customerIds = new Set(allowedCustomers.map(customer => customer.externalId));
  const selectedProducts = ["product[]", "prod_name[]", "prodc[]", "liquid_prod[]", "lub_prod[]", "lub_name[]", "lub_name1[]", "swipe_bank[]", "exp_type[]"].flatMap(key => Array.isArray(input[key]) ? (input[key] as unknown[]).map(String) : []);
  const productId = fieldValue(input, ["product", "prod_name", "prodc", "selct_prod", "lub_name"]);
  const vehicle = fieldValue(input, ["vehi_no", "vehicle_no", "credit_vehicles"]);
  const select = (moduleIds: string[], all = records) => all.filter(record => moduleIds.includes(record.module)
    && (!customerId || /all/i.test(customerId) || customerIds.has(fieldValue(source(record), CUSTOMER_KEYS)))
    && (!employeeId || /all/i.test(employeeId) || fieldValue(source(record), EMPLOYEE_KEYS) === employeeId)
    && (!vendorId || /all/i.test(vendorId) || fieldValue(source(record), VENDOR_KEYS) === vendorId)
    && (!productId || /all/i.test(productId) || fieldValue(source(record), PRODUCT_KEYS) === productId)
    && (!vehicle || /all/i.test(vehicle) || fieldValue(source(record), ["vehi_no", "vehicle_no", "lubvehi_no"]) === vehicle));
  const sections: ReportSection[] = [];
  const section = (rows: ReportRow[], fallback: string[], title = spec.title, layout = 0) => {
    const headers = spec.tables[layout]?.headers;
    sections.push({ title, columns: headers && headers.length > 1 ? headers : fallback, rows });
  };
  const sales = () => select(["credit-sales", "lubricant-sales"]);
  const credits = () => select(["credit-sales", "lubricant-sales"]).filter(row => row.module === "credit-sales" || /credit/i.test(fieldValue(source(row), ["sale_type1", "sale_type"])));
  const purchases = () => select(["fuel-purchases", "lubricant-purchases", "other-purchases", "lfr-invoices"]);
  const allFor = async (modules: string[]) => (await transactionRecords(actor.workspaceId, modules, { from: "1900-01-01", to }, false)).map(entry => displayNames(entry, masters, closing));
  const purchaseItems = (rows = purchases()): ReportRow[] => rows.flatMap(record => {
    const f = source(record), list = Array.isArray(f.items) ? f.items.map(jsonFields) : [f];
    return list.map(item => ({ ...rowFor(record), ...item, invoice: fieldValue(f, ["invo_no", "invoiceno", "invoice"], String(record.number)), product_id: fieldValue(item, PRODUCT_KEYS), product: name(record.module === "lubricant-purchases" ? "lubricants" : "fuel-products", fieldValue(item, PRODUCT_KEYS)),
      quantity: fieldValue(item, ["quantity", "pro_qty", "pur_proqty"], record.quantity), price: fieldValue(item, ["rate", "purrate", "price"], record.rate), basicamount: fieldValue(item, ["basic_amount", "purcost", "pro_amt"], "0"), taxablevalue: fieldValue(item, ["taxable_amount", "pur_billamt", "tot_val", "purcost"], "0"), vatamount: fieldValue(item, ["purvat", "pur_vat"], "0"), cgst: fieldValue(item, ["pur_cgst", "cgst"], "0"), sgst: fieldValue(item, ["pur_sgst", "sgst"], "0"), igst: fieldValue(item, ["pur_igst", "igst"], "0"), tcs: fieldValue(item, ["purtcs", "pur_tcs"], "0"), cess: fieldValue(item, ["cess", "pur_cess"], "0"), lfr: fieldValue(item, ["lfr", "pur_lfr"], "0"), total: fieldValue(item, ["amount", "total_amount", "pur_itemtot"], record.amount), amount: fieldValue(item, ["amount", "total_amount", "pur_itemtot"], record.amount) }));
  });
  const taxRows = (): ReportRow[] => sales().map(record => {
    const f = source(record), base = rowFor(record), product = (masters[record.module === "lubricant-sales" ? "lubricants" : "fuel-products"] || []).find(row => row.externalId === String(base.product_id)), customer = (masters.customers || []).find(row => row.externalId === String(base.customer_id));
    const gst = fieldNumber(f, ["gstrate", "gst_rate", "gst"], fieldNumber(product?.fields as PetrosoftFields || {}, "gst")), amount = money(record.amount), taxable = gst ? money(amount.div(1 + gst / 100)) : amount;
    const tax = amount.sub(taxable), igst = fieldNumber(f, ["s_igst", "igst"]), gstin = fieldValue(f, ["gst_no", "s_gstno", "custgst_no"], fieldValue(customer?.fields as PetrosoftFields || {}, ["cust_gstno", "gst_no"]));
    return { ...base, gst, taxrate: gst, gstin, hsn: fieldValue(product?.fields as PetrosoftFields || {}, "hsn_code"), taxablevalue: taxable.toString(), tax: tax.toString(), cgst: igst ? "0" : money(tax.div(2)).toString(), sgst: igst ? "0" : money(tax.div(2)).toString(), igst: igst ? tax.toString() : "0", cess: "0", uqc: record.module === "lubricant-sales" ? "NOS" : "LTR", placeofsupply: fieldValue(actor.workspace.settings as PetrosoftFields, "supply_location", "Karnataka"), receiver: base.customer };
  });

  if ([1, 5, 19].includes(index)) {
    if (index === 1) {
      for (const customer of allowedCustomers) {
        const posts = await petrosoftDb.petrosoftLedger.findMany({ where: { entityType: "customer", entityId: customer.externalId, date: { gte: range.from, lte: range.to }, entry: { workspaceId: actor.workspaceId, status: { not: "void" } } }, include: { entry: true }, orderBy: [{ date: "asc" }, { id: "asc" }] });
        let balance = money(opening.customer?.[customer.externalId]?.balance || 0);
        const rows: ReportRow[] = [{ date: from, product: "Opening Balance", balance: balance.toString(), collectable: balance.gt(0) ? balance.toString() : "0", payment: balance.lt(0) ? balance.abs().toString() : "0" }];
        for (const post of posts) { const entry = displayNames(serializeEntry(post.entry), masters, closing); balance = balance.add(post.debit).sub(post.credit); rows.push({ ...rowFor(entry), collectable: post.debit.toString(), payment: post.credit.toString(), balance: balance.toString() }); }
        section(rows, ["S.No", "Date", "Product", "Amount", "Payment", "Balance"], customer.name);
      }
    } else section(credits().map(rowFor), ["Date", "Vehicle No", "Product", "Quantity", "Price", "Amount"]);
  } else if ([2, 17].includes(index)) section(credits().map(record => ({ ...rowFor(record), mobile: fieldValue((masters.customers || []).find(customer => customer.externalId === fieldValue(source(record), CUSTOMER_KEYS))?.fields as PetrosoftFields || {}, "phone_no") })), ["Date", "Customer", "Vehicle No", "Product", "Quantity", "Price", "Amount"]);
  else if ([3, 6, 16].includes(index)) {
    const history = await allFor(["credit-sales", "recoveries", "lubricant-sales"]);
    const rows: ReportRow[] = [];
    for (const customer of allowedCustomers) {
      const customerHistory = history.filter(record => fieldValue(source(record), CUSTOMER_KEYS) === customer.externalId), customerSales = customerHistory.filter(record => record.module === "credit-sales" || record.module === "lubricant-sales" && /credit/i.test(fieldValue(source(record), ["sale_type1", "sale_type"])));
      const paid = sum(customerHistory.filter(record => record.module === "recoveries")).add(customerHistory.filter(record => record.module === "recoveries").reduce((total, record) => total.add(fieldValue(source(record), "discount", "0")), money(0)));
      const buckets = group(customerSales.map(record => ({ ...rowFor(record), month: record.date.slice(0, 7), customer: customer.name })), row => String(row.month), ["amount"]);
      let remainingPayments = paid.sub(fieldValue(customer.fields as PetrosoftFields, "open_bal", "0"));
      const pending: Record<string, string> = {};
      for (const bucket of buckets.sort((a, b) => String(a.month).localeCompare(String(b.month)))) { const debt = money(bucket.amount || 0), applied = remainingPayments.gt(0) ? PrismaMin(debt, remainingPayments) : money(0); remainingPayments = remainingPayments.sub(applied); pending[String(bucket.month)] = debt.sub(applied).toString(); }
      if (index === 16) {
        const row: ReportRow = { customer: customer.name, balance: closing.customer?.[customer.externalId]?.balance || "0", previouspendingbalance: "0" };
        for (let offset = 0; offset < 4; offset++) { const month = new Date(Date.UTC(range.to.getUTCFullYear(), range.to.getUTCMonth() - offset, 1)); const key = month.toISOString().slice(0, 7); row[new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(month).replace(" ", "-").toLowerCase()] = pending[key] || "0"; }
        row.previouspendingbalance = money(row.balance || 0).sub(Object.values(row).filter((_, offset) => offset > 2).reduce<ReturnType<typeof money>>((sum, item) => sum.add(String(item || 0)), money(0))).toString(); rows.push(row);
      } else for (const bucket of buckets.filter(row => String(row.month) >= from.slice(0, 7))) rows.push({ ...bucket, credit: pending[String(bucket.month)] || "0", saleamount: bucket.amount, paidamount: money(bucket.amount || 0).sub(pending[String(bucket.month)] || 0).toString(), dueamount: pending[String(bucket.month)] || "0", dateperiod: bucket.month });
    }
    if (index === 16) {
      const columns = ["Customer", "Balance", ...Array.from({ length: 4 }, (_, offset) => new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(range.to.getUTCFullYear(), range.to.getUTCMonth() - offset, 1))).replace(" ", "-")), "Previous Pending Balance"];
      sections.push({ title: spec.title, columns, rows });
    } else section(rows, ["Customer", "Month", "Credit"]);
  } else if (index === 4) {
    const history = await allFor(["credit-sales", "recoveries", "lubricant-sales"]), rows: ReportRow[] = [];
    for (const customer of allowedCustomers) {
      const selected = history.filter(record => fieldValue(source(record), CUSTOMER_KEYS) === customer.externalId), creditRows = selected.filter(record => record.module === "credit-sales" || /credit/i.test(fieldValue(source(record), ["sale_type1", "sale_type"]))).sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number);
      let payments = sum(selected.filter(record => record.module === "recoveries")).sub(fieldValue(customer.fields as PetrosoftFields, "open_bal", "0"));
      for (const record of creditRows) { const debt = money(record.amount), applied = payments.gt(0) ? PrismaMin(debt, payments) : money(0); payments = payments.sub(applied); const balance = debt.sub(applied); if (balance.gt(0)) rows.push({ ...rowFor(record), type: record.module === "credit-sales" ? "Liquid" : "Lubricant", saleamount: debt.toString(), recoveryamount: applied.toString(), balance: balance.toString() }); }
    }
    section(rows, ["Type", "Product", "Quantity", "Indent No", "Sale Amount", "Recovery Amount", "Balance"]);
  } else if (index === 7) {
    let rows = select(["expenses"]); const selected = Array.isArray(input["exp_type[]"]) ? (input["exp_type[]"] as unknown[]).map(String) : [];
    if (selected.length) rows = rows.filter(record => selected.includes(fieldValue(source(record), "exp_type")));
    const mode = fieldValue(input, "mode"); if (mode && !/all/i.test(mode)) rows = rows.filter(record => fieldValue(source(record), "exp_paytype", "Cash") === mode);
    section(rows.map(record => ({ ...rowFor(record), category: fieldValue(source(record), "flow", "Outflow"), transtype: fieldValue(source(record), "expense_name") })), ["Date", "Employee", "Expense Type", "Flow", "Mode", "Amount", "Description"]);
  } else if (index === 8) section(select(["settlements"]).filter(record => fieldNumber(source(record), "pettycash") > 0).map(record => ({ ...rowFor(record), pettycash: fieldValue(source(record), "pettycash"), balance: "0" })), ["Date", "Petty Cash", "Expenses", "Balance"]);
  else if (index === 9) {
    const rates = await transactionRecords(actor.workspaceId, ["daily-rates"], { from, to }, false);
    section(rates.filter(record => !selectedProducts.length || selectedProducts.includes(fieldValue(source(record), PRODUCT_KEYS))).map(record => ({ ...rowFor(displayNames(record, masters)), oldrate: fieldValue(source(record), "old_rate", "0"), salerate: record.rate, vamt: money(fieldValue(source(record), "old_rate", "0")).sub(record.rate).toString(), stock: fieldValue(source(record), "ms", "0"), stockamount: fieldValue(source(record), "amt", "0"), vprice: fieldValue(source(record), "v_amt", "0"), saleqty: record.quantity })), ["Date", "Product", "Old Rate", "Sale Rate", "Variation"]);
  } else if ([10, 11, 62, 63, 64].includes(index)) {
    const rows = purchaseItems(index === 63 ? select(["fuel-purchases"]) : [11, 62, 64].includes(index) ? select(["lubricant-purchases", "other-purchases"]) : purchases());
    section(rows, ["Invoice", "Date", "Vendor", "Product", "Quantity", "Price", "Taxable Value", "CGST", "SGST", "IGST", "Total"]);
  } else if ([12, 59, 65].includes(index)) section(taxRows(), ["InvNo", "Inv_Dt", "Pty_Name", "Vch_Type", "GSTIN", "Product_Name", "HSNCode", "Qty", "UOM", "TaxPer", "TaxableAmt", "IGSTAmt", "SGSTAmt", "CGSTAmt", "Net_Amt", "Narration"]);
  else if (index === 13) section([...(masters["fuel-products"] || []), ...(masters.lubricants || [])].map(record => ({ ...rowFor(record), product: record.name, hsn: fieldValue(source(record), "hsn_code"), gst: fieldValue(source(record), "gst"), uqc: record.module === "lubricants" ? "NOS" : "LTR" })), ["Product Name", "HSN Code", "GST", "UQC"]);
  else if (index === 14) section([...(masters.customers || []), ...(masters.vendors || []), ...(masters["business-parties"] || [])].map(record => ({ name: record.name, type: record.module, gstin: fieldValue(source(record), ["cust_gstno", "gst_no"]), openingbalance: fieldValue(source(record), "open_bal", "0"), mobile: fieldValue(source(record), ["phone_no", "ven_phno", "mobile"]), address: fieldValue(source(record), ["org_address", "vend_details", "address"]) })), ["Ledger Name", "Type", "GSTIN", "Mobile", "Address", "Opening Balance"]);
  else if ([15, 22, 23, 25].includes(index)) {
    const recoveries = index === 25 ? await allFor(["recoveries"]) : [];
    const rows = allowedCustomers.map(customer => {
      const current = closing.customer?.[customer.externalId], before = opening.customer?.[customer.externalId], last = recoveries.find(record => fieldValue(source(record), CUSTOMER_KEYS) === customer.externalId), f = customer.fields as PetrosoftFields;
      return { customer: customer.name, organization: customer.name, mobile: fieldValue(f, "phone_no"), creditlimit: fieldValue(f, "credit_limit", "0"), limit: fieldValue(f, "credit_limit", "0"), openingbalance: before?.balance || "0", collectable: money(current?.debit || 0).sub(before?.debit || 0).toString(), recovery: money(current?.credit || 0).sub(before?.credit || 0).toString(), receivedamount: current?.credit || "0", balance: current?.balance || "0", closingbalance: current?.balance || "0", outstanding: current?.balance || "0", lastpaiddays: last ? Math.floor((range.to.getTime() - new Date(last.date).getTime()) / 86400000) : "", lastpaiddate: last?.date || "" };
    }).filter(row => index !== 23 || money(row.limit).gt(0) && money(row.balance).gt(row.limit));
    section(rows, ["Organization", "Mobile", "Credit Limit", "Collectable", "Recovery", "Balance"]);
  } else if (index === 18) section(select(["recoveries"]).filter(record => !fieldValue(input, "recover_type") || /all/i.test(fieldValue(input, "recover_type")) || fieldValue(source(record), "re_type") === fieldValue(input, "recover_type")).map(record => ({ ...rowFor(record), received: fieldValue(source(record), "re_type"), receivedamount: record.amount, customername: fieldValue(source(record), "cust_name") })), ["Date", "Organization", "Received Amount", "Discount", "Description"]);
  else if ([20, 21].includes(index)) {
    const tax = index === 20 ? "tcs" : "tds";
    section(taxRows().map(row => ({ ...row, [tax]: money(row.amount || 0).mul(fieldNumber(row, `${tax}_per`)).div(100).toString() })).filter(row => money(row[tax] || 0).gt(0)), ["Date", "Organization", "Invoice", "Amount", tax.toUpperCase()]);
  } else if (index === 24) section(group(credits().map(rowFor), row => `${row.customer_id}:${row.vehicle}`, ["amount"]).map(row => ({ ...row, cumulativeamount: row.amount })), ["Customer Name", "Vehicle Num", "Amount", "Cumulative Amount"]);
  else if ([26, 27, 44].includes(index)) {
    const attendance = select(["attendance-details"]);
    if (index === 44) section(attendance.map(record => ({ ...rowFor(record), attendedstatus: fieldValue(source(record), "attend_type"), remarks: fieldValue(source(record), "attend_remark") })), ["Date", "Employee", "Status", "Shift", "Remarks"]);
    else if (index === 27) section((masters.employees || []).filter(employee => !employeeId || employee.externalId === employeeId).map(employee => ({ employee: employee.name, presentdays: attendance.filter(record => fieldValue(source(record), EMPLOYEE_KEYS) === employee.externalId && fieldValue(source(record), "attend_type").startsWith("P")).length, absentdays: attendance.filter(record => fieldValue(source(record), EMPLOYEE_KEYS) === employee.externalId && fieldValue(source(record), "attend_type") === "A").length })), ["Employee", "Present Days", "Absent Days"]);
    else {
      const grouped = new Map<string, ReportRow>();
      for (const record of records.filter(record => !employeeId || fieldValue(source(record), EMPLOYEE_KEYS) === employeeId)) {
        const id = fieldValue(source(record), EMPLOYEE_KEYS); if (!id) continue;
        const key = record.date + ":" + id, row = grouped.get(key) || { date: record.date, employee: name("employees", id) }, module = baseModule(record.module);
        const column: Record<string, string> = { "meter-sales": "sale", "lubricant-sales": "lubsale", recoveries: "crdrecovery", swipes: "swipe", "credit-sales": "credit", expenses: "expenses", "employee-recoveries": "cashcollection" };
        if (column[module]) add(row, column[module], record.amount);
        if (module === "credit-sales") add(row, "salediscount", fieldValue(source(record), "discount", "0"));
        if (module === "employee-recoveries") add(row, "shortage", fieldValue(source(record), "shortage", "0"));
        grouped.set(key, row);
      }
      section([...grouped.values()], ["Date", "Employee", "Sale", "Swipe", "Credit", "Recovery", "Expenses", "Collected", "Shortage"]);
    }
  } else if ([28, 87].includes(index)) {
    const audits = await petrosoftDb.petrosoftAudit.findMany({ where: { workspaceId: actor.workspaceId, createdAt: { gte: range.from, lt: new Date(range.to.getTime() + 86400000) }, ...(fieldValue(input, "mode") && !/all/i.test(fieldValue(input, "mode")) ? { module: fieldValue(input, "mode") } : {}) }, orderBy: { createdAt: "desc" } });
    section(audits.map(audit => ({ transactionid: audit.entryId || "", date: audit.createdAt.toISOString().slice(0, 10), createddate: audit.createdAt.toISOString().slice(0, 10), event: audit.action, eventtime: audit.createdAt.toISOString().slice(11, 19), module: audit.module, user: audit.username, ipaddress: "" })), ["Transaction ID", "Module", "Created Date", "Event", "Event Time", "User"]);
  } else if ([29, 30, 31, 32, 77, 82].includes(index)) {
    const summaries = dailySummary(records);
    if (index === 82) section(group(records.filter(record => ["credit-sales", "lubricant-sales", "recoveries"].includes(record.module)).map(record => ({ date: record.date, lubricants: record.module === "lubricant-sales" ? fieldValue(source(record), "discount", "0") : "0", liquids: record.module === "credit-sales" ? fieldValue(source(record), "discount", "0") : "0", recovery: record.module === "recoveries" ? fieldValue(source(record), "discount", "0") : "0" })), row => String(row.date), ["lubricants", "liquids", "recovery"]), ["Date", "Lubricants", "Liquids", "Recovery"]);
    else if (index === 32) {
      section(group(select(["meter-sales"]).map(record => ({ ...rowFor(record), nozzle: fieldValue(source(record), "nozzle_name"), cr: fieldValue(source(record), "close_read"), or: fieldValue(source(record), "open_read"), testing: fieldValue(source(record), "test_qty", "0"), sale: record.quantity, saletotals: record.amount })), row => `${row.product_id}:${row.nozzle}`, ["testing", "sale", "saletotals"]), ["Product", "Nozzle", "CR", "OR", "Testing", "Sale", "Sale Totals"]);
      section(group(select(["lubricant-sales"]).map(rowFor), row => String(row.product_id), ["quantity", "amount"]), ["Product", "Quantity", "Amount"], "Lub Sales", 1);
    } else if (index === 77) {
      const rows = group(select(["meter-sales"]).map(record => ({ date: record.date, [fieldValue((masters["fuel-products"] || []).find(product => product.externalId === fieldValue(source(record), PRODUCT_KEYS))?.fields as PetrosoftFields || {}, "short_name", "Product")]: record.amount, total: record.amount })), row => String(row.date), [...(masters["fuel-products"] || []).map(product => fieldValue(product.fields as PetrosoftFields, "short_name", product.name)), "total"]);
      sections.push({ title: spec.title, columns: ["Date", ...(masters["fuel-products"] || []).map(product => fieldValue(product.fields as PetrosoftFields, "short_name", product.name)), "Total"], rows });
    } else if (index === 31) section(select(["settlements"]).map(record => ({ ...rowFor(record), cashinflow: fieldValue(source(record), "totinflw", "0"), cashoutflow: fieldValue(source(record), "total_outflow", "0"), openingcash: fieldValue(source(record), "opencash", "0"), closingcash: fieldValue(source(record), "closecash", record.amount) })), ["Date", "Opening Cash", "Cash Inflow", "Cash Outflow", "Closing Cash"]);
    else { sections.push({ title: spec.title, columns: ["Date", "Meter Sale", "Lubs Sale", "Recovery", "Cash In", "Total Cash", "Swipe", "Credit Sale", "Sale Discount", "Expenses", "Bank Recovery", "Shortage", "Hand Cash", "Opening Cash", "Closing Cash"], rows: summaries }); }
  } else if ([33, 34, 35].includes(index)) {
    const allPurchases = await allFor(["fuel-purchases", "lubricant-purchases"]), allItems = purchaseItems(allPurchases);
    for (const product of masters[fieldValue(input, "gross_type", "Liquids").toLowerCase().includes("lub") ? "lubricants" : "fuel-products"] || []) {
      if (productId && product.externalId !== productId) continue;
      const lots = allItems.filter(row => row.product_id === product.externalId).sort((a, b) => String(a.date).localeCompare(String(b.date))).map(row => ({ date: String(row.date), remaining: quantity(row.quantity || 0), price: quantity(row.quantity || 0).gt(0) ? money(row.total || 0).div(quantity(row.quantity || 1)) : money(0) }));
      const selectedSales = select([product.module === "lubricants" ? "lubricant-sales" : "meter-sales"]).filter(record => fieldValue(source(record), PRODUCT_KEYS) === product.externalId).sort((a, b) => a.date.localeCompare(b.date));
      const rows: ReportRow[] = [];
      for (const record of selectedSales) {
        const available = lots.filter(lot => lot.date <= record.date && lot.remaining.gt(0));
        let need = quantity(record.quantity), cost = money(0);
        if (index === 33) { const totalQty = available.reduce((sum, lot) => sum.add(lot.remaining), quantity(0)), totalCost = available.reduce((sum, lot) => sum.add(lot.remaining.mul(lot.price)), money(0)); cost = totalQty.gt(0) ? money(need.mul(totalCost.div(totalQty))) : money(need.mul(lots[0]?.price || 0)); }
        else { for (const lot of available) { if (need.lte(0)) break; const used = PrismaMin(need, lot.remaining); cost = cost.add(used.mul(lot.price)); lot.remaining = lot.remaining.sub(used); need = need.sub(used); } if (need.gt(0)) cost = cost.add(need.mul(available[0]?.price || lots[0]?.price || 0)); }
        rows.push({ ...rowFor(record), product: product.name, saleqty: record.quantity, salerate: record.rate, purchaserate: quantity(record.quantity).gt(0) ? money(cost.div(record.quantity)).toString() : "0", variationrate: quantity(record.quantity).gt(0) ? money(money(record.amount).sub(cost).div(record.quantity)).toString() : "0", gain: money(money(record.amount).sub(cost)).toString(), totalgain: money(money(record.amount).sub(cost)).toString() });
      }
      sections.push({ title: product.name, columns: ["Date", "Product", "Sale Rate", "Purchase Rate", "Variation Rate", "Sale Qty", "Gain"], rows });
    }
  } else if ([36, 37, 41, 43, 46, 71, 72, 73, 74, 89].includes(index)) {
    const stocks = await tankStock(actor.workspaceId, range.to, masters);
    if ([41, 46, 89].includes(index)) {
      const type = index === 46 ? "gifts" : "lubricants", prefix = index === 46 ? "gift:" : "lub:", productRows: ReportRow[] = [];
      const movements = await petrosoftDb.petrosoftLedger.findMany({ where: { entityType: "product", date: { lte: range.to }, entry: { workspaceId: actor.workspaceId, status: { not: "void" } } }, include: { entry: { select: { module: true } } } });
      for (const product of masters[type] || []) { const list = movements.filter(row => row.entityId === prefix + product.externalId), openingQty = list.filter(row => row.date < range.from).reduce((sum, row) => sum.add(row.quantity), quantity(0)), period = list.filter(row => row.date >= range.from), purchase = period.filter(row => row.quantity.gt(0)).reduce((sum, row) => sum.add(row.quantity), quantity(0)), sale = period.filter(row => row.quantity.lt(0) && !/loss/.test(row.entry.module)).reduce((sum, row) => sum.sub(row.quantity), quantity(0)), loss = period.filter(row => /loss/.test(row.entry.module)).reduce((sum, row) => sum.sub(row.quantity), quantity(0)), closingQty = openingQty.add(purchase).sub(sale).sub(loss); productRows.push({ product: product.name, location: "Bunk", openingstock: openingQty.toString(), purchase: purchase.toString(), sale: sale.toString(), loss: loss.toString(), closingstock: closingQty.toString(), closingvalue: money(closingQty.mul(fieldValue(product.fields as PetrosoftFields, "sale_rate", "0"))).toString() }); }
      section(productRows, ["Product", "Opening Stock", "Purchase", "Sale", "Loss", "Closing Stock", "Closing Value"]);
    } else if ([36, 37].includes(index)) {
      section(stocks.map(stock => ({ ...stock.fields, product: name("fuel-products", stock.fields.product), totalstock: stock.quantity, price: rates[stock.fields.product]?.closing || "0", amount: money(stock.quantity).mul(rates[stock.fields.product]?.closing || 0).toString(), openingstock: stock.fields.open_stock, stockreceipt: stock.fields.receipt, actualstock: stock.fields.close_stock, dipstock: stock.fields.dip_stock, variationstock: fieldValue(stock.fields, "stk_variation", "0") })), ["Product", "Open Stock", "Receipt", "Closing Stock", "Price", "Amount"]);
      sections.push({ title: "Balances", columns: ["Account", "Balance"], rows: [
        { account: "Cash", balance: closing.cash?.cash?.balance || "0" },
        { account: "Credit Customers", balance: Object.values(closing.customer || {}).reduce((sum, item) => sum.add(item.balance), money(0)).toString() },
        { account: "Banks", balance: Object.values(closing.bank || {}).reduce((sum, item) => sum.add(item.balance), money(0)).toString() },
        { account: "Vendors", balance: Object.values(closing.vendor || {}).reduce((sum, item) => sum.add(item.balance), money(0)).toString() },
      ] });
    } else {
      const rows: ReportRow[] = select(["opening-stock"]).map(record => ({ ...rowFor(record), ...source(record), tank: fieldValue(source(record), "tank_name", fieldValue(source(record), "tank_no")), product: name("fuel-products", fieldValue(source(record), PRODUCT_KEYS)), openstock: fieldValue(source(record), "open_stock", "0"), totalstock: fieldValue(source(record), "total_stk", "0"), totalsale: fieldValue(source(record), "meter_sale", "0"), netmetersale: fieldValue(source(record), "meter_sale", "0"), actualstock: fieldValue(source(record), "close_stock", "0"), dipstock: fieldValue(source(record), "dip_stock", "0"), variation: fieldValue(source(record), "stk_variation", "0") }));
      if (index === 74) { const valued = group(rows.map(row => ({ date: row.date, [fieldValue((masters["fuel-products"] || []).find(product => product.externalId === String(row.product_id))?.fields as PetrosoftFields || {}, "short_name", "Product")]: money(row.actualstock || 0).mul(rates[String(row.product_id)]?.closing || 0).toString(), totalvalue: money(row.actualstock || 0).mul(rates[String(row.product_id)]?.closing || 0).toString() })), row => String(row.date), [...(masters["fuel-products"] || []).map(product => fieldValue(product.fields as PetrosoftFields, "short_name", product.name)), "totalvalue"]); section(valued, ["Date", "HSD", "MS", "OIL", "Total Value"]); }
      else section(rows.filter(row => !fieldValue(input, "tank") || String(row.tank_no) === fieldValue(input, "tank")), ["Date", "Tank", "Product", "Open Stock", "Receipt", "Total Stock", "Meter Sale", "Closing Stock", "Dip Stock", "Variation"]);
    }
  } else if ([38, 39, 40].includes(index)) {
    if (index === 39) section(purchaseItems().filter(row => row.tank_no).map(row => ({ ...row, tank: name("tanks", String(row.tank_no)), received: row.quantity, purchaseqty: row.quantity })), ["Date", "Tank", "Product", "Invoice", "Purchase Qty", "Received", "Variation"]);
    else section(select(["opening-stock"]).map(record => ({ ...rowFor(record), ...source(record), tank: fieldValue(source(record), "tank_name"), variation: fieldValue(source(record), "stk_variation", "0"), variationamount: fieldValue(source(record), "vari_amnt", "0"), previousstock: fieldValue(source(record), "open_stock", "0"), receipts: fieldValue(source(record), "receipt", "0"), currentstock: fieldValue(source(record), "dip_stock", "0"), metersales: fieldValue(source(record), "meter_sale", "0"), actualsales: fieldValue(source(record), "meter_sale", "0"), dipsales: money(fieldValue(source(record), "total_stk", "0")).sub(fieldValue(source(record), "dip_stock", "0")).toString() })), ["Date", "Tank", "Product", "Variation", "Variation Amount"]);
  } else if ([42, 60, 61, 80, 81].includes(index)) {
    const vendor = index === 42, type = vendor ? "vendor" : fieldValue(input, ["partytype", "partytyp"], "Bank"), selected = vendor ? (masters.vendors || []).filter(row => !vendorId || row.externalId === vendorId) : (masters["business-parties"] || []).filter(row => (!fieldValue(input, "crd_name") || row.externalId === fieldValue(input, "crd_name")) && (!type || /all/i.test(type) || fieldValue(source(row), ["p_type", "partyType"]) === type));
    if ([80, 81].includes(index)) section(selected.map(party => { const kind = /bank/i.test(fieldValue(source(party), ["p_type", "partyType"])) ? "bank" : "party", before = opening[kind]?.[party.externalId], after = closing[kind]?.[party.externalId]; return { creditorname: party.name, mobile: fieldValue(source(party), "mobile"), openingbalance: before?.balance || "0", credit: money(after?.credit || 0).sub(before?.credit || 0).toString(), debit: money(after?.debit || 0).sub(before?.debit || 0).toString(), closingbalance: after?.balance || "0" }; }), ["Creditor Name", "Opening Balance", "Credit", "Debit", "Closing Balance"]);
    else for (const party of selected) {
      const kind = vendor ? "vendor" : /bank/i.test(fieldValue(source(party), ["p_type", "partyType"])) ? "bank" : "party";
      const posts = await petrosoftDb.petrosoftLedger.findMany({ where: { entityType: kind, entityId: party.externalId, date: { gte: range.from, lte: range.to }, entry: { workspaceId: actor.workspaceId, status: { not: "void" } } }, include: { entry: true }, orderBy: { date: "asc" } });
      let balance = money(opening[kind]?.[party.externalId]?.balance || 0);
      const rows = posts.map(post => { balance = balance.add(post.debit).sub(post.credit); return { ...rowFor(displayNames(serializeEntry(post.entry), masters)), credit: post.credit.toString(), debit: post.debit.toString(), balance: balance.toString(), type: post.entry.module }; });
      section(rows, ["Date", "Credit", "Debit", "Balance", "Type", "Description"], party.name);
    }
  } else if ([45, 47, 48].includes(index)) {
    if (index === 45) section(select(["guest-sales"]).map(record => ({ ...rowFor(record), name: name("guests", fieldValue(source(record), ["guest_id", "customer_id"])), mobile: fieldValue(source(record), ["mobileno", "g_mobileno"]), saletype: fieldValue(source(record), ["coll_type", "collection_mode"]) })), ["Date", "Mobile", "Name", "Vehicle No", "Product", "Quantity", "Amount"]);
    else if (index === 48) section((masters.guests || []).map(guest => ({ name: guest.name, mobile: fieldValue(source(guest), ["g_number", "g_mobileno"]), tier: fieldValue(source(guest), "tier"), points: closing.loyalty?.[guest.externalId]?.quantity || "0" })), ["Mobile No", "Name", "Tier", "Points"]);
    else {
      const posts = await petrosoftDb.petrosoftLedger.findMany({ where: { entityType: "loyalty", date: { gte: range.from, lte: range.to }, entry: { workspaceId: actor.workspaceId, status: { not: "void" } } }, include: { entry: true }, orderBy: { date: "asc" } });
      const running: Record<string, ReturnType<typeof quantity>> = {};
      section(posts.map(post => { running[post.entityId] ||= quantity(opening.loyalty?.[post.entityId]?.quantity || 0); running[post.entityId] = running[post.entityId].add(post.quantity); return { ...rowFor(displayNames(serializeEntry(post.entry), masters)), earnedpoints: post.quantity.gt(0) ? post.quantity.toString() : "0", redeempoints: post.quantity.lt(0) ? post.quantity.abs().toString() : "0", closingpoints: running[post.entityId].toString() }; }), ["Date", "Product", "Quantity", "Earned Points", "Redeem Points", "Closing Points"]);
    }
  } else if ([49, 50, 56, 66, 67, 68, 69, 70].includes(index)) {
    let rows = taxRows();
    if ([66, 68].includes(index)) rows = rows.filter(row => !row.gstin || row.gstin === "0");
    if ([67, 69].includes(index)) rows = rows.filter(row => row.gstin && row.gstin !== "0");
    if ([49, 67, 68].includes(index)) rows = group(rows, row => `${row.hsn}:${row.gst}:${row.product}`, ["quantity", "amount", "taxablevalue", "igst", "sgst", "cgst", "cess"]);
    if (index === 56) rows = group(rows, row => String(row.date), ["quantity", "amount", "taxablevalue", "igst", "sgst", "cgst", "cess"]);
    if (index === 70) rows = [{ description: "Non-GST outward supplies", nilratedsupplies: "0", exempted: "0", nongstsupplies: rows.filter(row => !row.gst).reduce((sum, row) => sum.add(String(row.amount || 0)), money(0)).toString() }];
    section(rows, ["Date", "GSTIN", "HSN", "Product", "Quantity", "Rate", "Taxable Value", "IGST", "CGST", "SGST", "Total Amount"]);
  } else if ([51, 52, 53, 54, 55].includes(index)) {
    const items = purchaseItems();
    if (index === 51) section(items.filter(row => money(row.tcs || 0).gt(0)), ["Date", "Product", "Invoice No", "TCS"]);
    else if (index === 54) section(items.filter(row => money(row.lfr || 0).gt(0)), ["Date", "Product", "Invoice No", "LFR", "GST", "Total"]);
    else if (index === 55) section(taxRows().map(row => ({ ...row, tds: money(row.amount || 0).mul(fieldNumber(row, "tds_per")).div(100).toString() })).filter(row => money(row.tds || 0).gt(0)), ["Date", "Invoice No", "Invoice Total", "TDS"]);
    else { section(group(items, row => String(row.product_id), ["quantity", "basicamount", "vatamount", "cess", "tcs", "amount"]), ["Product", "Quantity", "Basic Amount", "VAT Amount", "Cess", "TCS", "Total Amount"], "Purchases"); section(group(taxRows(), row => String(row.product_id), ["quantity", "amount", "taxablevalue", "cgst", "sgst", "igst"]), ["Product", "Quantity", "Amount", "Taxable Value"], "Sales", 1); }
  } else if ([57, 58].includes(index)) {
    const swipes = select(["swipes"]).filter(record => !selectedProducts.length || selectedProducts.includes(fieldValue(source(record), "swipe_bank")));
    const machineId = fieldValue(input, "swipe_name");
    if (index === 57) section(swipes.map(record => { const machine = (masters["swipe-machines"] || []).find(item => item.externalId === fieldValue(source(record), "swipe_bank")), f = machine?.fields as PetrosoftFields || {}; return { ...rowFor(record), attachedbankvendor: name(f.attach_type === "Vendor" ? "vendors" : "business-parties", fieldValue(f, "attach_id")), batchid: fieldValue(source(record), "swp_billno"), swipecash: record.amount }; }), ["Date", "Attached Bank/Vendor", "Batch Id", "Swipe cash", "Description"]);
    else {
      const combined: ReportRow[] = swipes.map(record => ({ date: record.date, machine: fieldValue(source(record), "swipe_bank"), swipesaleamount: record.amount, settlementamount: "0", settlementcharges: "0", swipedescription: fieldValue(source(record), "swipe_des") }));
      for (const record of select(["swipe-settlements"])) combined.push({ date: record.date, machine: fieldValue(source(record), "swipe_bank"), swipesaleamount: "0", settlementamount: record.amount, settlementcharges: fieldValue(source(record), "charges", "0") });
      const running: Record<string, ReturnType<typeof money>> = {};
      const rows = group(combined, row => `${row.date}:${row.machine}`, ["swipesaleamount", "settlementamount", "settlementcharges"]).filter(row => !machineId || String(row.machine) === machineId).sort((a, b) => String(a.date).localeCompare(String(b.date))).map(row => { const id = String(row.machine); running[id] ||= money(opening.swipe?.[id]?.balance || 0); running[id] = running[id].add(String(row.swipesaleamount || 0)).sub(String(row.settlementamount || 0)).sub(String(row.settlementcharges || 0)); return { ...row, attachedbankvendor: name("swipe-machines", id), closingamount: running[id].toString() }; });
      section(rows, ["Date", "Swipe", "Swipe Sale Amount", "Settlement Amount", "Settlement Charges", "Closing Amount"]);
    }
  } else if ([75, 76, 78, 79].includes(index)) {
    if (index === 75) section(select(["handling-loss", "lubricant-loss"]).map(rowFor), ["Date", "Product", "Quantity", "Price", "Amount", "Description"]);
    else if (index === 76) { const rows = group(select(["meter-sales"]).map(rowFor), row => `${row.date}:${row.product_id}`, ["quantity", "amount"]); for (const row of rows) { const credit = credits().filter(record => record.date === row.date && fieldValue(source(record), PRODUCT_KEYS) === row.product_id); row.saleqty = row.quantity; row.creditsaleqty = sum(credit, "quantity").toString(); row.creditsaleamount = sum(credit).toString(); } section(rows, ["Date", "Product", "Sale Qty", "Credit Sale Qty", "Credit Sale Amount", "Amount"]); }
    else { const module = index === 79 ? "lubricant-sales" : /lub/i.test(fieldValue(input, ["saleType_month", "saleType"])) ? "lubricant-sales" : "meter-sales"; section(group(select([module]).map(record => ({ ...rowFor(record), month: record.date.slice(0, 7), litres: record.quantity, taxable: record.amount })), row => `${row.product_id}:${row.month}`, ["quantity", "litres", "amount", "taxable"]), ["Product", "Month", "Quantity", "Amount"]); }
  } else if ([83, 84].includes(index)) section(select(transactionModules.filter(module => module.startsWith("bowser-"))).map(record => ({ ...rowFor(record), bowsername: name("bowsers", fieldValue(source(record), ["bowser", "bowser_id", "Bowser_Crd", "Bowser_Exp", "Bowser_lub", "Bowser_Swipe", "Recovery_Crd"])) })), ["Date", "Bowser Name", "Employee", "Product", "Quantity", "Rate", "Amount"]);
  else if (index === 85) section(Array.from({ length: 5 }, (_, offset) => ({ rating: offset + 1, counts: select(["feedback"]).filter(record => fieldNumber(source(record), "rating") === offset + 1).length })), ["Rating", "Counts"]);
  else if (index === 86) section(select(["interest"]).map(rowFor), ["Date", "Party", "Loan Amount", "Principal Paid", "Interest Paid", "Balance", "Description"]);
  else if (index === 88) section(select(["meter-sales"]).map(record => ({ ...rowFor(record), benchmarks: "", salequantity: record.quantity, saleamount: record.amount, incentiveamount: fieldValue(source(record), "incentives", "0") })).filter(row => money(row.incentiveamount || 0).gt(0)), ["Date", "Benchmarks", "Shift", "Product", "Sale Quantity", "Sale Amount", "Incentive Amount"]);
  else if (index === 90) section(select(["godown-transfers"]).map(rowFor), ["Date", "From Location", "To Location", "Product", "Quantity", "Description"]);
  else if (index === 91) {
    if (fieldValue(input, "data_source", "database").toLowerCase() === "api") throw new PetrosoftError("Configure the BPCL fleet API for live fleet transactions.", 503);
    section(select(["swipes", "recoveries"]).filter(record => /vendor/i.test(fieldValue(source(record), ["re_type", "attach_type"])) || fieldValue(source(record), "vendor_id") !== "0").map(rowFor), ["Date", "Vehicle No", "Product", "Amount", "Reference No"]);
  } else section(records.map(rowFor), ["Date", "Type", "Product", "Customer", "Quantity", "Amount", "Description"]);
  if (!sections.length) sections.push({ title: spec.title, columns: spec.tables[0]?.headers || ["Date", "Description", "Amount"], rows: [] });
  return { title: spec.title, from, to, sections, format: spec.format };
}

function PrismaMin(a: ReturnType<typeof money>, b: ReturnType<typeof money>) { return a.lt(b) ? a : b; }
export { reportSpecs, rowFor };
