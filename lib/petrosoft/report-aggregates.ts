import type { PetrosoftActor } from "./auth";
import { fieldNumber, fieldValue, jsonFields, type PetrosoftFields } from "./catalog";
import { petrosoftDb } from "./db";
import { dailySummary, transactionRecords, type BalanceMap, type PublicEntry } from "./queries";
import { baseModule, EMPLOYEE_KEYS, money, PRODUCT_KEYS, quantity } from "./rules";
import type { ReportRow, ReportSection } from "./report-data";
import reportCatalog from "./reports.json";

interface ReportContext {
  actor: PetrosoftActor; index: number; input: PetrosoftFields; from: string; to: string;
  range: { from: Date; to: Date }; masters: Record<string, PublicEntry[]>;
  opening: BalanceMap; closing: BalanceMap;
  rates: Record<string, { opening: string; closing: string; date: string; id: string }>;
  records: PublicEntry[];
  select: (modules: string[], records?: PublicEntry[]) => PublicEntry[];
  name: (module: string, id: string) => string;
  rowFor: (record: PublicEntry) => ReportRow;
  purchaseItems: (records?: PublicEntry[]) => ReportRow[];
  taxRows: () => ReportRow[];
}
const handled = new Set([26, 27, 30, 32, 36, 37, 40, 41, 43, 46, 49, 52, 53, 55, 71, 72, 73, 74, 76, 77, 78, 79, 84, 88, 89]);
const value = (record: PublicEntry, names: string | string[], fallback = "") => fieldValue(record.fields, names, fallback);
const number = (offered: unknown) => money(offered ?? 0);
const sum = (rows: ReportRow[], key: string) => rows.reduce((total, row) => total.add(number(row[key])), money(0));
const sumEntries = (rows: PublicEntry[], key: "amount" | "quantity" = "amount") => rows.reduce((total, row) => total.add(row[key]), money(0));
function add(row: ReportRow, key: string, offered: unknown) { row[key] = number(row[key]).add(number(offered)).toString(); }
function grouped(rows: ReportRow[], key: (row: ReportRow) => string, measures: string[]) {
  const groups = new Map<string, ReportRow>();
  for (const row of rows) {
    const id = key(row);
    if (!groups.has(id)) groups.set(id, { ...row, ...Object.fromEntries(measures.map(measure => [measure, "0"])) });
    const target = groups.get(id)!;
    for (const measure of measures) add(target, measure, row[measure]);
  }
  return [...groups.values()];
}
function total(rows: ReportRow[], measures: string[], label = "date"): ReportRow {
  return { [label]: "Total", ...Object.fromEntries(measures.map(key => [key, sum(rows, key).toString()])) };
}
function choices(input: PetrosoftFields, names: string[]) {
  return [...new Set(names.flatMap(name => {
    const offered = input[name] ?? input[`${name}[]`];
    return offered === undefined ? [] : (Array.isArray(offered) ? offered : [offered]).map(item => String(item).split("|")[0]).filter(item => item && !/^(all|0)$/i.test(item));
  }))];
}
function days(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`).getTime(), end = new Date(`${to}T00:00:00Z`).getTime();
  const length = Math.floor((end - start) / 86400000) + 1;
  if (length > 3660) throw new Error("Choose a report period of ten years or less.");
  return Array.from({ length }, (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10));
}

export async function extendedReport(c: ReportContext): Promise<ReportSection[] | null> {
  if (!handled.has(c.index)) return null;
  const { actor, index, input, masters, from, to, records, select, name, rowFor, opening, closing } = c;
  const spec = reportCatalog.find(report => report.index === index)!;
  const sections: ReportSection[] = [];
  const section = (layout: number, title: string, rows: ReportRow[], fallback: string[], totals?: ReportRow) => {
    const columns = spec.tables[layout]?.headers;
    sections.push({ title, columns: columns && columns.length > 1 ? columns.map(column => column || "Particulars") : fallback, rows, ...(totals ? { totals } : {}) });
  };

  if ([26, 27].includes(index)) {
    const employeeIds = choices(input, ["emp_id", "emp_name", "day_emp"]);
    const employees = (masters.employees || []).filter(employee => !employeeIds.length || employeeIds.includes(employee.externalId));
    const period = days(from, to), measures = ["sale", "lubsale", "pettycash", "crdrecovery", "cashin", "swipe", "credit", "salediscount", "expenses", "cashcollection", "shortage"];
    const business: ReportRow[] = [];
    for (const employee of employees) for (const date of period) {
      const selected = records.filter(record => record.date === date && value(record, EMPLOYEE_KEYS) === employee.externalId);
      const row: ReportRow = { date, employee: employee.name, ...Object.fromEntries(measures.map(key => [key, "0"])) };
      for (const record of selected) {
        const moduleId = baseModule(record.module);
        if (moduleId === "meter-sales") add(row, "sale", record.amount);
        if (moduleId === "lubricant-sales") add(row, "lubsale", record.amount);
        if (moduleId === "recoveries" && /cash/i.test(value(record, "re_type", "Cash"))) add(row, "crdrecovery", record.amount);
        if (moduleId === "swipes") add(row, "swipe", record.amount);
        if (moduleId === "credit-sales") { add(row, "credit", record.amount); add(row, "salediscount", value(record, ["discount", "credit_discnt"], "0")); }
        if (moduleId === "lubricant-sales" && /credit/i.test(value(record, ["sale_type1", "sale_type"]))) add(row, "credit", record.amount);
        if (moduleId === "expenses" && /cash/i.test(value(record, "exp_paytype", "Cash"))) add(row, /inflow/i.test(value(record, "flow")) ? "cashin" : "expenses", record.amount);
        if (moduleId === "employee-recoveries") add(row, "cashcollection", record.amount);
        if (moduleId === "settlements") add(row, "pettycash", value(record, "pettycash", "0"));
      }
      row.businessamt = number(row.sale).add(number(row.lubsale)).add(number(row.crdrecovery)).add(number(row.cashin)).add(number(row.pettycash)).sub(number(row.swipe)).sub(number(row.credit)).sub(number(row.salediscount)).sub(number(row.expenses)).toString();
      row.collectedamt = row.cashcollection;
      row.shortage = number(row.businessamt).sub(number(row.cashcollection)).toString();
      business.push(row);
    }
    if (index === 26) {
      section(0, spec.title, business, ["Date", "Employee", "Sale", "Lub Sale", "PettyCash", "Crd.Recovery", "Cash In", "Swipe", "Credit", "Sale Discount", "Expenses", "Cash collection", "Shortage"], total(business, measures));
      const productColumns = (spec.tables[1]?.headers || ["Date", "Employee", ...(masters["fuel-products"] || []).map(product => product.name)]).slice(2);
      const rows = business.map(row => {
        const result: ReportRow = { date: row.date, employee: row.employee };
        for (const column of productColumns) {
          const product = (masters["fuel-products"] || []).find(product => product.name.toLowerCase() === column.toLowerCase() || value(product, "short_name").toLowerCase() === column.toLowerCase());
          result[column] = sumEntries(records.filter(record => record.module === "meter-sales" && record.date === row.date && value(record, EMPLOYEE_KEYS) === employees.find(employee => employee.name === row.employee)?.externalId && value(record, PRODUCT_KEYS) === product?.externalId), "quantity").toString();
        }
        return result;
      });
      section(1, "Product Sales", rows, ["Date", "Employee", ...productColumns], total(rows, productColumns));
    } else {
      const counts = employees.map(employee => {
        const attendance = records.filter(record => record.module === "attendance-details" && value(record, EMPLOYEE_KEYS) === employee.externalId);
        return { employee: employee.name, "Present days": attendance.reduce((count, record) => count + (value(record, "attend_type") === "P" ? 1 : /^(H|P:A)$/.test(value(record, "attend_type")) ? 0.5 : 0), 0), "Absent days": attendance.reduce((count, record) => count + (value(record, "attend_type") === "A" ? 1 : /^(H|P:A)$/.test(value(record, "attend_type")) ? 0.5 : 0), 0) };
      });
      section(0, "Attendance", counts, ["Employee", "Present days", "Absent days"]);
      section(1, "Business Collection", business, ["Date", "Business Amt", "Collected Amt", "Shortage"], total(business, ["businessamt", "collectedamt", "shortage"]));
      const meters = select(["meter-sales"]).sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number).map(record => ({ ...rowFor(record), pump: value(record, ["pump_name", "pump_no", "pump_id"]), nozzle: value(record, ["nozzle_name", "nozzle", "nozzle_id"]), saleqty: record.quantity, saleamt: record.amount }));
      section(2, "Nozzle Sales", meters, ["Date", "Pump", "Nozzle", "Product", "Sale Qty", "Sale Amt"], total(meters, ["saleqty", "saleamt"]));
      const payments = select(["employee-payments", "employee-loans", "employee-recoveries"]).map(record => {
        const row: ReportRow = { ...rowFor(record), Loan: "0", LoanRecovery: "0", Advance: "0", "Adv.Recovery": "0", Salary: "0" };
        const type = value(record, ["pay_type", "paym_type", "type", "flow"]);
        row[/salary/i.test(type) ? "Salary" : /loan/i.test(type) ? /recover/i.test(type) ? "LoanRecovery" : "Loan" : /recover/i.test(type) ? "Adv.Recovery" : "Advance"] = record.amount;
        return row;
      });
      section(3, "Employee Transactions", payments, ["Date", "Employee", "Loan", "LoanRecovery", "Advance", "Adv.Recovery", "Salary"]);
    }
    return sections;
  }

  if (index === 30) {
    const swipeRows = grouped(select(["swipes"]).map(record => {
      const machine = (masters["swipe-machines"] || []).find(machine => machine.externalId === value(record, "swipe_bank"));
      return { "Swipe Machine": machine?.name || value(record, "swipe_bank"), "Bank / Account": machine ? name(/vendor/i.test(value(machine, "attach_type")) ? "vendors" : "business-parties", value(machine, ["attach_id", "attach_bank"])) : "", "Batch No": value(record, ["batch_id", "swp_billno", "billno"]), Txns: "1", amount: record.amount };
    }), row => `${row["Swipe Machine"]}:${row["Batch No"]}`, ["Txns", "amount"]);
    section(0, "Swipe Collection", swipeRows, ["Swipe Machine", "Bank / Account", "Batch No", "Txns", "Amount"], total(swipeRows, ["Txns", "amount"], "Swipe Machine"));
    const cashPosts = await petrosoftDb.petrosoftLedger.findMany({ where: { entityType: "cash", date: { gte: c.range.from, lte: c.range.to }, entry: { workspaceId: actor.workspaceId, status: { not: "void" } } } });
    const summaries = new Map(dailySummary(records).map(row => [row.date, row]));
    const columns = ["meter_sale", "lubricant_sale", "recovery", "cash_in", "total_cash", "swipe", "credit", "discount", "expenses", "bank_recovery", "shortage", "hand_cash", "cashinflow", "cashoutflow"];
    let running = number(opening.cash?.cash?.balance);
    const rows = days(from, to).map(date => {
      const summary = summaries.get(date) || { date };
      const posts = cashPosts.filter(post => post.date.toISOString().slice(0, 10) === date);
      const row: ReportRow = { ...Object.fromEntries(columns.map(column => [column, "0"])), ...summary, date, openingcash: running.toString(), cashinflow: posts.reduce((sum, post) => sum.add(post.debit), money(0)).toString(), cashoutflow: posts.reduce((sum, post) => sum.add(post.credit), money(0)).toString() };
      running = running.add(number(row.cashinflow)).sub(number(row.cashoutflow));
      const settlement = records.find(record => record.module === "settlements" && record.date === date);
      if (settlement) running = number(value(settlement, ["closecash", "closing_cash"], running.toString()));
      row.closingcash = running.toString();
      return row;
    });
    section(1, spec.title, rows, ["Date", "Meter Sale", "Lubs Sale", "Recovery", "CashIn", "Total Cash", "Swipe", "Credit Sale", "Sale Disc.", "Expenses", "Recovery trxn", "Shortage", "Hand Cash", "Opening Cash", "Inflow", "Outflow", "Closing Cash", "Discount"], { ...total(rows, columns), openingcash: opening.cash?.cash?.balance || "0", closingcash: running.toString() });
    return sections;
  }

  if ([49, 52, 53, 55, 76, 77, 78, 79].includes(index)) {
    const saleType = fieldValue(input, ["saleType", "saleType_month"], "liquid");
    const saleRecords = select([/lub/i.test(saleType) || index === 79 ? "lubricant-sales" : "meter-sales"]);
    const taxes = c.taxRows();
    const taxMeasures = ["quantity", "amount", "taxablevalue", "igst", "sgst", "cgst", "cess", "count"];
    if (index === 49) {
      section(0, "HSN Summary", grouped(taxes.map(row => ({ ...row, count: "1" })), row => `${row.hsn}:${row.gst}:${row.product}`, taxMeasures), ["HSN", "Product", "Tax Rate", "Quantity", "Taxable Value", "IGST", "CGST", "SGST", "Total Amount"]);
      section(1, "Registered Customers", taxes.filter(row => row.gstin && row.gstin !== "0").map(row => ({ ...row, count: "1" })), ["Date", "GSTIN", "Receiver Name", "Invoice No", "Taxable Value", "IGST", "CGST", "SGST", "Total Amount"]);
      section(2, "Unregistered Customers", grouped(taxes.filter(row => !row.gstin || row.gstin === "0").map(row => ({ ...row, count: "1" })), row => `${row.hsn}:${row.gst}:${row.product}`, taxMeasures), ["HSN", "Product", "Quantity", "Taxable Value", "Tax Rate", "CGST", "SGST", "IGST", "Total Amount"]);
    } else if ([52, 53].includes(index)) {
      const purchases = c.purchaseItems();
      const sales = select(["meter-sales", "lubricant-sales"]).map(record => {
        const product = (masters[record.module === "meter-sales" ? "fuel-products" : "lubricants"] || []).find(product => product.externalId === value(record, PRODUCT_KEYS));
        const rate = fieldNumber(record.fields, ["vat", "vat_rate", "gst"], fieldNumber(product?.fields || {}, record.module === "meter-sales" ? "vat" : "gst"));
        const taxable = rate ? money(number(record.amount).div(1 + rate / 100)) : number(record.amount);
        return { ...rowFor(record), basicamount: taxable.toString(), vatamount: number(record.amount).sub(taxable).toString(), vatpercent: rate, saleamount: record.amount, cess: value(record, "cess", "0") };
      });
      const purchaseRows = grouped(purchases.map(row => ({ ...row, purchaseamount: row.amount })), row => String(row.product_id), ["quantity", "basicamount", "vatamount", "cess", "tcs", "amount", "purchaseamount"]);
      const saleRows = grouped(sales, row => `${row.product_id}:${row.vatpercent}`, ["quantity", "basicamount", "vatamount", "cess", "amount", "saleamount"]);
      const purchaseVat = sum(purchaseRows, "vatamount"), saleVat = sum(saleRows, "vatamount"), credit = number(fieldValue(actor.workspace.settings as PetrosoftFields, "vat_credit_balance", "0")), payable = saleVat.sub(purchaseVat).sub(credit);
      if (index === 52) {
        section(0, "Sales", saleRows, ["Product Name", "Sale Amount", "VAT Amount", "Cess"]);
        section(1, "Purchases", purchaseRows, ["Product Name", "Purchase Amount", "VAT Amount + D.C", "Cess"]);
        sections.push({ title: "VAT Payable", columns: ["Particulars", "Amount"], rows: [{ Particulars: "Brought forward", amount: credit.toString() }, { Particulars: "Input tax", amount: purchaseVat.toString() }, { Particulars: "Output tax", amount: saleVat.toString() }, { Particulars: "Payable", amount: payable.toString() }] });
      } else {
        section(0, "Purchases", purchaseRows, ["Product", "Quantity", "Basic Amount", "VAT %", "VAT Amount", "Cess", "TCS", "Total Amount"]);
        section(1, "Sales", saleRows, ["Product", "Quantity", "Basic Amount", "VAT %", "VAT Amount", "Total Amount"]);
        section(2, "VAT Summary", [{ "Credit balance": credit.toString(), "Purchase VAT": purchaseVat.toString(), "Sale VAT": saleVat.toString(), "Payable VAT": payable.toString(), "Total Payable": payable.gt(0) ? payable.toString() : "0" }], ["Credit balance", "Purchase VAT", "Sale VAT", "Payable VAT", "Total Payable"]);
      }
    } else if (index === 55) {
      section(0, "Sales TDS", taxes.map(row => ({ ...row, tds: number(row.amount).mul(fieldNumber(row, "tds_per")).div(100).toString() })).filter(row => number(row.tds).gt(0)), ["Date", "Invoice No", "Invoice Total", "TDS"]);
      section(1, "Recovery TDS", select(["recoveries"]).map(record => ({ ...rowFor(record), tds: value(record, ["tds", "tds_amount"], "0") })).filter(row => number(row.tds).gt(0)), ["Date", "Customer", "Amount", "TDS"]);
    } else if (index === 76) {
      const rows = grouped(saleRecords.map(record => ({ ...rowFor(record), saleqty: record.quantity })), row => `${row.date}:${row.product_id}`, ["quantity", "saleqty", "amount"]);
      const credits = select(["credit-sales", "lubricant-sales"]).filter(record => record.module === "credit-sales" || /credit/i.test(value(record, ["sale_type1", "sale_type"])));
      for (const row of rows) { const selected = credits.filter(record => record.date === row.date && value(record, PRODUCT_KEYS) === row.product_id); row.creditsaleqty = sumEntries(selected, "quantity").toString(); row.creditsaleamount = sumEntries(selected).toString(); }
      for (const product of masters[/lub/i.test(saleType) ? "lubricants" : "fuel-products"] || []) section(0, product.name, rows.filter(row => row.product_id === product.externalId).sort((a, b) => String(a.date).localeCompare(String(b.date))), ["Date", "Sale Qty", "Credit Sale Qty", "Credit Sale Amount", "Amount"]);
    } else if (index === 77) {
      const products = masters[/lub/i.test(saleType) ? "lubricants" : "fuel-products"] || [];
      const rows = grouped(saleRecords.map(record => ({ date: record.date, [name(record.module === "meter-sales" ? "fuel-products" : "lubricants", value(record, PRODUCT_KEYS))]: record.amount, total: record.amount })), row => String(row.date), [...products.map(product => product.name), "total"]);
      sections.push({ title: spec.title, columns: ["Date", ...products.map(product => product.name), "Total"], rows: rows.sort((a, b) => String(a.date).localeCompare(String(b.date))) });
    } else {
      const rows = grouped(saleRecords.map(record => {
        const product = (masters[record.module === "lubricant-sales" ? "lubricants" : "fuel-products"] || []).find(product => product.externalId === value(record, PRODUCT_KEYS));
        const tax = taxes.find(row => row.id === record.id);
        return { ...rowFor(record), hsn: value(product || record, "hsn_code"), month: record.date.slice(0, 7), litres: record.quantity, taxable: tax?.taxablevalue ?? record.amount, cgst: tax?.cgst ?? "0", sgst: tax?.sgst ?? "0" };
      }), row => `${row.product_id}:${row.month}`, ["quantity", "litres", "amount", "taxable", "cgst", "sgst"]);
      section(0, spec.title, rows.sort((a, b) => String(a.month).localeCompare(String(b.month))), ["Product", "Month", "Quantity", "Amount"]);
    }
    return sections;
  }

  if (index === 84) {
    const rows = select(records.map(record => record.module).filter(moduleId => moduleId.startsWith("bowser-")));
    const sales = rows.filter(record => ["bowser-sales", "bowser-lubricant-sales"].includes(record.module)).map(record => ({ ...rowFor(record), "Product Type": record.module === "bowser-sales" ? "Liquid" : "Lubricant", "Sale(Qty)": record.quantity, "Sale Amount": record.amount, Credit: value(record, "credit_amount", "0"), Cash: value(record, "cash_amount", record.amount) }));
    section(0, "Bowser Sales", grouped(sales, row => String(row.product_id), ["Sale(Qty)", "Sale Amount", "Credit", "Cash"]), ["Product", "Product Type", "Sale(Qty)", "Sale Amount", "Credit", "Cash"]);
    section(1, "Meter Sales", rows.filter(record => record.module === "bowser-sales").map(rowFor), ["Date", "Bowser Name", "Employee", "Quantity", "Amount"]);
    section(2, "Credit Sales", rows.filter(record => record.module === "bowser-credit-sales").map(rowFor), ["Date", "Customer", "Product", "Quantity", "Amount"]);
    section(3, "Swipes", rows.filter(record => record.module === "bowser-swipes").map(rowFor), ["Employee", "Swipe", "Amount", "Description"]);
    section(4, "Expenses", rows.filter(record => record.module === "bowser-expenses").map(rowFor), ["Employee", "Expense", "Description", "Amount"]);
    section(5, "Recoveries", rows.filter(record => record.module === "bowser-recoveries").map(rowFor), ["Customer", "Employee", "Discount", "Recovered Amount", "Collection Mode"]);
    return sections;
  }
  if (index === 88) {
    const nozzleIds = choices(input, ["nozz", "nozzle"]), productIds = choices(input, ["prod_str", "product"]);
    const rows = select(["meter-sales"]).filter(record => (!nozzleIds.length || nozzleIds.includes(value(record, ["nozzle", "nozzle_id"]))) && (!productIds.length || productIds.includes(value(record, PRODUCT_KEYS)))).map(record => {
      const rules = (masters["pump-incentives"] || []).filter(rule => value(rule, "pump_id") === value(record, "pump_id") && (!value(rule, "product") || value(rule, "product") === value(record, PRODUCT_KEYS)));
      const rule = rules.filter(rule => fieldNumber(rule.fields, ["benchmark", "min_qty", "bench_qty"]) <= Number(record.quantity)).sort((a, b) => fieldNumber(b.fields, ["benchmark", "min_qty", "bench_qty"]) - fieldNumber(a.fields, ["benchmark", "min_qty", "bench_qty"]))[0];
      return { ...rowFor(record), benchmarks: rule ? value(rule, ["benchmark", "min_qty", "bench_qty"], "0") : "", salequantity: record.quantity, saleamount: record.amount, incentiveamount: value(record, ["incentive", "incentives"], rule ? money(quantity(record.quantity).mul(fieldNumber(rule.fields, ["rate", "incentive", "amount"]))).toString() : "0") };
    });
    section(0, spec.title, rows, ["Date", "Benchmarks", "Shift", "Product", "Sale Quantity", "Sale Amount", "Incentive Amount"], total(rows, ["salequantity", "saleamount", "incentiveamount"]));
    return sections;
  }

  const inventory = await inventoryRows(c);
  if ([71, 73, 43].includes(index)) {
    const productIds = choices(input, ["product", "prodc"]), tankIds = choices(input, ["tank"]);
    const productwise = index === 73 || fieldValue(input, "dsr", "productwise") === "productwise";
    const selected = inventory.filter(row => (!productIds.length || productIds.includes(String(row.product_id))) && (productwise || !tankIds.length || tankIds.includes(String(row.tank))));
    const measures = ["openstock", "purchase", "receipt", "totalstock", "totalsale", "testing", "netmetersale", "actualstock", "dipstock", "variation", "dipsale", "stocklimit", "salelimit"];
    const rows = grouped(selected, row => `${row.date}:${productwise ? row.product_id : row.tank}`, measures).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const cumulative = new Map<string, { sale: ReturnType<typeof quantity>; variation: ReturnType<typeof quantity> }>();
    for (const row of rows) { const id = String(productwise ? row.product_id : row.tank), running = cumulative.get(id) || { sale: quantity(0), variation: quantity(0) }; running.sale = running.sale.add(number(row.netmetersale)); running.variation = running.variation.add(number(row.variation)); row["Cumulative Sales"] = running.sale.toString(); row["Cumulative Vari."] = running.variation.toString(); row["DIP SALE"] = row.dipsale; row["Actual Stock(4%)"] = row.stocklimit; row["Meter Sale(0.60%)"] = row.salelimit; cumulative.set(id, running); }
    if (index === 73) sections.push({ title: spec.title, columns: ["Date", "Tank", "Dip Reading", "Density", "OpenStock", "Receipt", "Total Stock", "Testing", "Opening Reading", "Closing Reading", "Net Meter Sale", "Actual Stock", "Dip.Stock", "Vari.", "Cumulative Vari."], rows });
    else for (const id of [...new Set(rows.map(row => String(productwise ? row.product_id : row.tank)))]) section(0, productwise ? name("fuel-products", id) : id, rows.filter(row => String(productwise ? row.product_id : row.tank) === id), ["Date", "OpenStock", "Receipt", "Total Stock", "Total Sale", "Testing", "Net Meter Sale", "Actual Stock", "Dip Stock", "Vari."]);
    return sections.length ? sections : [{ title: spec.title, columns: spec.tables[0]?.headers || ["Date", "Product", "Quantity"], rows: [] }];
  }
  if (index === 72) {
    const tankIds = choices(input, ["tank"]);
    const rows = inventory.filter(row => !tankIds.length || tankIds.includes(String(row.tank))).map(row => ({ ...row, Date: row.date, Temp: row.temp, "Hydro.Read": row.hydrometer, Density: row.density, "Invoice No": row.invoice || "", Qty: row.receipt, "Inv.Density": row.invoice_density || "", "Ob.Temp": row.ob_temp || "", "ob.Hydro": row.ob_hydro || "", "ob.Density": row.ob_density || "", Vari: row.ob_variation || "0", "Dec.Temp": row.dec_temp || "", "Dec.Hydro Read": row.dec_hydro || "", "Dec.Density": row.dec_density || "", "Dec.Vari": row.dec_variation || "0" }));
    sections.push({ title: spec.title, columns: ["Date", "Tank", "Temp", "Hydro.Read", "Density", "Invoice No", "Qty", "Inv.Density", "Ob.Temp", "ob.Hydro", "ob.Density", "Vari", "Dec.Temp", "Dec.Hydro Read", "Dec.Density", "Dec.Vari"], rows });
    return sections;
  }
  if (index === 74) {
    const liquid = !/lub/i.test(fieldValue(input, "proType", "liquid"));
    const products = masters[liquid ? "fuel-products" : "lubricants"] || [];
    const rows: ReportRow[] = [];
    if (liquid) for (const date of days(from, to)) {
      const row: ReportRow = { date, totalvalue: "0" };
      for (const product of products) { const selected = inventory.filter(item => item.date === date && item.product_id === product.externalId); const stock = sum(selected, "totalstock"), amount = selected.reduce((total, item) => total.add(number(item.totalstock).mul(number(item.price))), money(0)); const label = value(product, "short_name", product.name); row[`${label} Stock`] = stock.toString(); row[`${label} Value`] = money(amount).toString(); add(row, "totalvalue", amount); }
      rows.push(row);
    }
    else {
      const history = await petrosoftDb.petrosoftLedger.findMany({ where: { entityType: "product", date: { lte: c.range.to }, entry: { workspaceId: actor.workspaceId, status: { not: "void" } } } });
      for (const date of days(from, to)) { const row: ReportRow = { date, totalvalue: "0" }; for (const product of products) { const stock = history.filter(post => post.entityId === `lub:${product.externalId}` && post.date.toISOString().slice(0, 10) <= date).reduce((sum, post) => sum.add(post.quantity), quantity(0)); const label = product.name, amount = money(stock.mul(number(value(product, "sale_rate", product.rate)))); row[`${label} Stock`] = stock.toString(); row[`${label} Value`] = amount.toString(); add(row, "totalvalue", amount); } rows.push(row); }
    }
    sections.push({ title: spec.title, columns: ["Date", ...products.flatMap(product => { const label = liquid ? value(product, "short_name", product.name) : product.name; return [`${label} Stock`, `${label} Value`]; }), "Total Value"], rows });
    return sections;
  }
  if (index === 40) {
    const rows: ReportRow[] = select(["sales-officer"]).map(record => ({ ...rowFor(record), previousstock: value(record, ["prevs_stock", "previousstock"], "0"), receipts: value(record, "receipt", "0"), totalstock: number(value(record, "prevs_stock", "0")).add(value(record, "receipt", "0")).toString(), currentstock: value(record, "dip_stock", "0"), metersales: value(record, ["sale", "meter_sale"], "0"), testing: value(record, "testing", "0"), actualsales: value(record, ["sale", "meter_sale"], "0"), dipsales: number(value(record, "prevs_stock", "0")).add(value(record, "receipt", "0")).sub(value(record, "dip_stock", "0")).toString(), variation: value(record, "stk_variation", "0"), "Vari.limit": value(record, "vari_limit", "0"), "%limit": value(record, "percent_limit", "0"), "4% limit": number(value(record, "dip_stock", "0")).mul(0.04).toString() }));
    (masters.tanks || []).forEach((tank, layout) => section(layout, tank.name, rows.filter(row => row.tank_no === value(tank, "tank_no", tank.externalId)), ["Date", "Previous Stock", "Receipt", "Total Stock", "Current Stock", "Meter Sales", "Testing", "Variation"]));
    return sections;
  }

  const lubricants = await productStocks(c, index === 46 ? "gifts" : "lubricants");
  if ([41, 46, 89].includes(index)) {
    const productIds = choices(input, ["stk_prod", "prod_str", "lub_name"]), locationIds = choices(input, ["stk_loc", "location_str"]);
    const rows = lubricants.filter(row => (!productIds.length || productIds.includes(String(row.product_id))) && (!locationIds.length || locationIds.includes(String(row.location_id))));
    section(0, spec.title, rows, ["Product", "Location", "Opening Stock", "Purchase", "Sale", "Loss", "Closing Stock", "Closing Value"]);
    return sections;
  }

  const fuelStocks = inventorySummary(inventory);
  const bankRows = accountRows(c, "bank", (masters["business-parties"] || []).filter(party => /bank/i.test(value(party, ["p_type", "partyType"]))));
  const creditorRows = accountRows(c, "party", (masters["business-parties"] || []).filter(party => !/bank/i.test(value(party, ["p_type", "partyType"]))));
  const vendorRows = accountRows(c, "vendor", masters.vendors || []);
  const creditSummary = [{ openingbalance: Object.values(opening.customer || {}).reduce((sum, row) => sum.add(row.balance), money(0)).toString(), credit: Object.values(closing.customer || {}).reduce((sum, row) => sum.add(row.debit), money(0)).sub(Object.values(opening.customer || {}).reduce((sum, row) => sum.add(row.debit), money(0))).toString(), collection: Object.values(closing.customer || {}).reduce((sum, row) => sum.add(row.credit), money(0)).sub(Object.values(opening.customer || {}).reduce((sum, row) => sum.add(row.credit), money(0))).toString(), closingbalance: Object.values(closing.customer || {}).reduce((sum, row) => sum.add(row.balance), money(0)).toString() }];
  const expenseRows = grouped(select(["expenses"]).map(record => ({ "Expenses Type": value(record, "expense_name", name("expense-types", value(record, "exp_type"))), inflow: /inflow/i.test(value(record, "flow")) ? record.amount : "0", outflow: /inflow/i.test(value(record, "flow")) ? "0" : record.amount })), row => String(row["Expenses Type"]), ["inflow", "outflow"]);
  const purchaseRows = [{ "Liquid(₹)": sumEntries(select(["fuel-purchases"])).toString(), "Lubricants(₹)": sumEntries(select(["lubricant-purchases"])).toString(), Liquid: sumEntries(select(["fuel-purchases"])).toString(), Lubricants: sumEntries(select(["lubricant-purchases"])).toString() }];
  const profitRows = profitSummary(c, fuelStocks, lubricants, expenseRows);
  if (index === 37) {
    const rows: ReportRow[] = [...fuelStocks.map(row => ({ Particulars: row.product, "TOTAL STOCK": row.actualstock, "PRICE (₹)": row.price, "AMT (₹)": number(row.actualstock).mul(number(row.price)).toString() })), ...lubricants.map(row => ({ Particulars: row.product, "TOTAL STOCK": row.closingstock, "PRICE (₹)": row.price, "AMT (₹)": row.closingvalue }))];
    for (const kind of ["bank", "customer", "vendor", "party", "cash"]) for (const [id, balance] of Object.entries(closing[kind] || {})) rows.push({ Particulars: kind === "cash" ? "Cash" : name(kind === "customer" ? "customers" : kind === "vendor" ? "vendors" : "business-parties", id), "TOTAL STOCK": "", "PRICE (₹)": "", "AMT (₹)": balance.balance });
    sections.push({ title: spec.title, columns: ["Particulars", "TOTAL STOCK", "PRICE (₹)", "AMT (₹)"], rows, totals: total(rows, ["AMT (₹)"], "Particulars") });
    return sections;
  }
  if (index === 32) {
    const meters = select(["meter-sales"]).sort((a, b) => a.date.localeCompare(b.date));
    const rows = grouped(meters.map(record => ({ ...rowFor(record), nozzle: value(record, ["nozzle_name", "nozzle", "nozzle_id"]), CR: value(record, "close_read", "0"), OR: value(record, "open_read", "0"), testing: value(record, "test_qty", "0"), sale: record.quantity, saletotals: record.amount })), row => `${row.product_id}:${row.nozzle}`, ["testing", "sale", "saletotals"]);
    for (const row of rows) { const matching = meters.filter(record => value(record, PRODUCT_KEYS) === row.product_id && value(record, ["nozzle_name", "nozzle", "nozzle_id"]) === row.nozzle); row.OR = matching[0]?.fields.open_read || "0"; row.CR = matching.at(-1)?.fields.close_read || "0"; }
    section(0, "Meter Sales", rows, ["Product", "Nozzle", "CR", "OR", "Testing", "Sale", "Sale Totals"]);
    section(1, "Lub Sales", grouped(select(["lubricant-sales"]).map(rowFor), row => String(row.product_id), ["quantity", "amount"]), ["Product Name", "Quantity", "Amount"]);
    section(2, "Fuel Stock", fuelStocks, ["Product", "Open Stock", "Stock Receipt", "Total Stock", "Sale", "Actual Stock", "Dip Stock", "Variation Stock", "Variation Amount", "Testing"]);
    section(3, "Bank Transactions", bankRows, ["Bank", "Opening Bal.", "Credited to Bunk", "Debited by Bunk", "Closing Bal."]);
    const swipes = (masters["swipe-machines"] || []).map(machine => ({ "Swipe Machine": machine.name, openingbalance: opening.swipe?.[machine.externalId]?.balance || "0", swipesaleamount: sumEntries(select(["swipes"]).filter(record => value(record, "swipe_bank") === machine.externalId)).toString(), settlementamount: sumEntries(select(["swipe-settlements"]).filter(record => value(record, "swipe_bank") === machine.externalId)).toString(), closingamount: closing.swipe?.[machine.externalId]?.balance || "0" }));
    section(4, "Swipe Vs Settlement", swipes, ["Swipe Machine", "Opening Balance", "Swipe Sale Amount", "Settlement Amount", "Closing Amount"]);
    section(5, "Credits", creditSummary, ["Opening Bal.", "Credit", "Collection", "Closing Bal."]);
    section(6, "Expenditure", expenseRows, ["Expenses Type", "Inflow", "Outflow"]);
    section(7, "Purchases", purchaseRows, ["Liquid(₹)", "Lubricants(₹)"]);
    section(8, "Stock Variations", [{ "Liquid(₹)": sum(fuelStocks, "variationamount").toString(), "Lubricants(₹)": sum(lubricants, "lossvalue").toString() }], ["Liquid(₹)", "Lubricants(₹)"]);
    section(9, "Profit/Loss", profitRows, ["Particulars", "Liquids (₹)", "Lubricants (₹)", "Total (₹)"]);
    section(10, "Creditor Transactions", creditorRows, ["Creditor Name", "Opening Balance", "Credit Amount", "Debit Amount", "Closing Balance"]);
    section(11, "Vendor Transactions", vendorRows, ["Customer", "Opening Balance", "Credit Amount", "Debit Amount", "Closing Balance"]);
    return sections;
  }
  if (index === 36) {
    section(0, "Fuel Stock", fuelStocks, ["Product", "Open Stock", "Stock Receipt", "Total Stock", "Sale", "Actual Stock", "Dip Stock", "Variation Stock", "Testing"]);
    section(1, "Lubricant Stock", lubricants, ["Product", "Open Stock", "Purchase", "Total Stock", "Sale", "Closing Stock"]);
    section(2, "Bank Transactions", bankRows, ["Bank", "Opening Bal.", "Credited to Bunk", "Debited by Bunk", "Closing Bal."]);
    section(3, "Credits", creditSummary, ["Opening Bal.", "Credit", "Collection", "Closing Bal."]);
    section(4, "Expenses", [{ Particulars: "Total Expenses", amount: sum(expenseRows, "outflow").sub(sum(expenseRows, "inflow")).toString() }], ["Particulars", "Amount"]);
    section(5, "Purchases", purchaseRows, ["Liquid", "Lubricants"]);
    section(6, "Profit/Loss", profitRows, ["Particulars", "Liquids (₹)", "Lubricants (₹)", "Total (₹)"]);
    const balanceRows: ReportRow[] = [];
    for (const kind of ["party", "bank", "customer", "vendor", "cash", "liability"]) for (const [id, balance] of Object.entries(closing[kind] || {})) { const amount = number(balance.balance); balanceRows.push({ Particulars: kind === "cash" ? "Cash" : name(kind === "customer" ? "customers" : kind === "vendor" ? "vendors" : "business-parties", id), Assets: amount.gt(0) ? amount.toString() : "0", Liabilities: amount.lt(0) ? amount.abs().toString() : "0" }); }
    for (const row of [...fuelStocks, ...lubricants]) balanceRows.push({ Particulars: row.product, Assets: row.closingvalue ?? number(row.actualstock).mul(number(row.price)).toString(), Liabilities: "0" });
    section(7, "Balance Sheet", balanceRows, ["Particulars", "Assets", "Liabilities"], total(balanceRows, ["Assets", "Liabilities"], "Particulars"));
    return sections;
  }
  return sections;
}

async function inventoryRows(c: ReportContext): Promise<ReportRow[]> {
  const { actor, masters, range, from, to } = c;
  const [snapshots, posts, rateHistory] = await Promise.all([
    transactionRecords(actor.workspaceId, ["opening-stock"], { from: "1900-01-01", to }, false),
    petrosoftDb.petrosoftLedger.findMany({ where: { entityType: "tank", date: { lte: range.to }, entry: { workspaceId: actor.workspaceId, status: { not: "void" } } } }),
    transactionRecords(actor.workspaceId, ["daily-rates"], { from: "1900-01-01", to }, false),
  ]);
  const rows: ReportRow[] = [];
  for (const tank of masters.tanks || []) {
    const tankNo = value(tank, "tank_no", tank.externalId), productId = value(tank, ["product", "pro_name"]);
    const history = snapshots.filter(snapshot => value(snapshot, ["tank_no", "stock_tank"]) === tankNo), movements = posts.filter(post => post.entityId === tankNo);
    for (const date of days(from, to)) {
      const snapshot = history.find(snapshot => snapshot.date <= date), sameDay = snapshot?.date === date, f = snapshot?.fields || {};
      let opening = quantity(fieldValue(f, sameDay ? ["open_stock", "opening_stock"] : ["close_stock", "closing_stock"], "0"));
      const after = movements.filter(post => (!snapshot || post.date.toISOString().slice(0, 10) > snapshot.date) && post.date.toISOString().slice(0, 10) <= date);
      for (const post of after.filter(post => post.date.toISOString().slice(0, 10) < date)) opening = opening.add(post.quantity);
      const today = after.filter(post => post.date.toISOString().slice(0, 10) === date);
      const receipt = sameDay ? quantity(fieldValue(f, "receipt", "0")) : today.filter(post => post.quantity.gt(0)).reduce((total, post) => total.add(post.quantity), quantity(0));
      const sale = sameDay ? quantity(fieldValue(f, "meter_sale", "0")) : today.filter(post => post.quantity.lt(0)).reduce((total, post) => total.sub(post.quantity), quantity(0));
      const meters = c.records.filter(record => record.module === "meter-sales" && record.date === date && value(record, ["tank_no", "stock_tank"]) === tankNo);
      const testing = meters.reduce((total, record) => total.add(value(record, "test_qty", "0")), quantity(0));
      const totalStock = opening.add(receipt), actual = totalStock.sub(sale), dip = quantity(sameDay ? fieldValue(f, "dip_stock", actual.toString()) : actual.toString());
      const rate = rateHistory.find(record => value(record, PRODUCT_KEYS) === productId && record.date <= date);
      const price = fieldValue(rate?.fields || {}, "cls_rate", rate?.rate || fieldValue(f, ["prod_rate", "price"], "0"));
      const item = c.purchaseItems(c.records.filter(record => record.module === "fuel-purchases" && record.date === date)).find(item => String(item.tank_no || item.tank) === tankNo);
      rows.push({ date, tank: tankNo, product_id: productId, product: c.name("fuel-products", productId), openstock: opening.toString(), purchase: item?.quantity || "0", receipt: receipt.toString(), totalstock: totalStock.toString(), totalsale: sale.add(testing).toString(), sale: sale.toString(), testing: testing.toString(), netmetersale: sale.toString(), actualstock: actual.toString(), dipstock: dip.toString(), variation: dip.sub(actual).toString(), variationamount: money(dip.sub(actual).mul(price)).toString(), dipsale: totalStock.sub(dip).toString(), stocklimit: quantity(dip.mul(0.04)).toString(), salelimit: quantity(sale.mul(0.006)).toString(), price, "Dip Reading": sameDay ? fieldValue(f, "dip_reading", "0") : "", temp: sameDay ? fieldValue(f, "temp_read", "0") : "0", hydrometer: sameDay ? fieldValue(f, "hydrometer_read", "0") : "0", density: sameDay ? fieldValue(f, "density_val", "0") : "0", "Density": sameDay ? fieldValue(f, "density_val", "0") : "0", "Opening Reading": meters.length ? value(meters.at(-1)!, "open_read", "0") : "0", "Closing Reading": meters.length ? value(meters[0], "close_read", "0") : "0", ...item });
    }
  }
  return rows;
}
function inventorySummary(rows: ReportRow[]) {
  const result: ReportRow[] = [];
  for (const productId of [...new Set(rows.map(row => String(row.product_id)))]) {
    const list = rows.filter(row => String(row.product_id) === productId).sort((a, b) => String(a.date).localeCompare(String(b.date))), first = list[0], last = list.at(-1);
    if (!first || !last) continue;
    const openingRows = list.filter(row => row.date === first.date), closingRows = list.filter(row => row.date === last.date);
    result.push({ product_id: productId, product: first.product, openstock: sum(openingRows, "openstock").toString(), receipt: sum(list, "receipt").toString(), totalstock: sum(openingRows, "openstock").add(sum(list, "receipt")).toString(), sale: sum(list, "netmetersale").toString(), actualstock: sum(closingRows, "actualstock").toString(), dipstock: sum(closingRows, "dipstock").toString(), variationstock: sum(list, "variation").toString(), variationamount: sum(list, "variationamount").toString(), testing: sum(list, "testing").toString(), "Total vari": sum(list, "variation").toString(), price: last.price, openingprice: first.price });
  }
  return result;
}
async function productStocks(c: ReportContext, type: "lubricants" | "gifts") {
  const prefix = type === "gifts" ? "gift:" : "lub:";
  const posts = await petrosoftDb.petrosoftLedger.findMany({ where: { entityType: "product", date: { lte: c.range.to }, entry: { workspaceId: c.actor.workspaceId, status: { not: "void" } } }, include: { entry: { select: { module: true, fields: true } } } });
  const result: ReportRow[] = [];
  const transfers = c.index === 89 ? await transactionRecords(c.actor.workspaceId, ["godown-transfers"], { from: "1900-01-01", to: c.to }, false) : [];
  const locationId = (offered: string) => !offered || /^(bunk|shop|0)$/i.test(offered) ? "0" : offered;
  for (const product of c.masters[type] || []) {
    if (c.index === 89) {
      const locations = [{ externalId: "0", name: "Bunk" }, ...(c.masters.godowns || [])];
      const selectedTransfers = transfers.filter(record => value(record, PRODUCT_KEYS) === product.externalId);
      for (const location of locations) {
        const selected = posts.filter(post => post.entityId === prefix + product.externalId && locationId(fieldValue(jsonFields(post.entry.fields), ["location_id", "stock_loc", "godown_id"])) === location.externalId);
        const incoming = selectedTransfers.filter(record => locationId(value(record, ["to_location", "to_loc"])) === location.externalId), outgoing = selectedTransfers.filter(record => locationId(value(record, ["from_location", "from_loc"])) === location.externalId);
        const open = selected.filter(post => post.date < c.range.from).reduce((total, post) => total.add(post.quantity), quantity(0)).add(sumEntries(incoming.filter(record => record.date < c.from), "quantity")).sub(sumEntries(outgoing.filter(record => record.date < c.from), "quantity"));
        const period = selected.filter(post => post.date >= c.range.from), transIn = sumEntries(incoming.filter(record => record.date >= c.from), "quantity"), transOut = sumEntries(outgoing.filter(record => record.date >= c.from), "quantity");
        const purchase = period.filter(post => post.quantity.gt(0)).reduce((total, post) => total.add(post.quantity), quantity(0)), loss = period.filter(post => /loss/.test(post.entry.module)).reduce((total, post) => total.sub(post.quantity), quantity(0)), sale = period.filter(post => post.quantity.lt(0) && !/loss/.test(post.entry.module)).reduce((total, post) => total.sub(post.quantity), quantity(0));
        const closing = open.add(purchase).add(transIn).sub(sale).sub(loss).sub(transOut), price = value(product, "sale_rate", product.rate);
        result.push({ product_id: product.externalId, product: product.name, location: location.name, location_id: location.externalId, openstock: open.toString(), openingstock: open.toString(), "Open.Qty": open.toString(), purchase: purchase.toString(), sale: sale.toString(), loss: loss.toString(), "Trans.In": transIn.toString(), "Trans.Out": transOut.toString(), closingstock: closing.toString(), Closing: closing.toString(), closingvalue: money(closing.mul(price)).toString() });
      }
      continue;
    }
    const selected = posts.filter(post => post.entityId === prefix + product.externalId);
    const before = selected.filter(post => post.date < c.range.from), period = selected.filter(post => post.date >= c.range.from);
    const open = before.reduce((total, post) => total.add(post.quantity), quantity(0)), purchase = period.filter(post => post.quantity.gt(0)).reduce((total, post) => total.add(post.quantity), quantity(0));
    const loss = period.filter(post => /loss/.test(post.entry.module)).reduce((total, post) => total.sub(post.quantity), quantity(0)), sale = period.filter(post => post.quantity.lt(0) && !/loss/.test(post.entry.module)).reduce((total, post) => total.sub(post.quantity), quantity(0));
    const closing = open.add(purchase).sub(sale).sub(loss), price = value(product, "sale_rate", product.rate);
    result.push({ product_id: product.externalId, product: product.name, location: "Bunk", location_id: "0", openstock: open.toString(), openingstock: open.toString(), purchase: purchase.toString(), receipt: purchase.toString(), totalstock: open.add(purchase).toString(), sale: sale.toString(), loss: loss.toString(), closingstock: closing.toString(), price, closingvalue: money(closing.mul(price)).toString(), lossvalue: money(loss.mul(price)).toString() });
  }
  return result;
}
function accountRows(c: ReportContext, type: string, parties: PublicEntry[]) {
  return parties.map(party => { const before = c.opening[type]?.[party.externalId], after = c.closing[type]?.[party.externalId], debit = number(after?.debit).sub(number(before?.debit)), credit = number(after?.credit).sub(number(before?.credit)); return { bank: party.name, creditorname: party.name, customer: party.name, openingbalance: before?.balance || "0", credit: credit.toString(), debit: debit.toString(), "Credit Amount": credit.toString(), "Debit Amount": debit.toString(), "Credited to Bunk": debit.toString(), "Debited by Bunk": credit.toString(), closingbalance: after?.balance || "0" }; });
}
function profitSummary(c: ReportContext, fuel: ReportRow[], lubricants: ReportRow[], expenses: ReportRow[]) {
  const openFuel = fuel.reduce((total, row) => total.add(number(row.openstock).mul(number(row.openingprice))), money(0)), closeFuel = fuel.reduce((total, row) => total.add(number(row.actualstock).mul(number(row.price))), money(0));
  const openLub = lubricants.reduce((total, row) => total.add(number(row.openstock).mul(number(row.price))), money(0)), closeLub = sum(lubricants, "closingvalue");
  const purchaseFuel = sumEntries(c.select(["fuel-purchases"])), purchaseLub = sumEntries(c.select(["lubricant-purchases"]));
  const saleFuel = sumEntries(c.select(["meter-sales"])), saleLub = sumEntries(c.select(["lubricant-sales"])), expense = sum(expenses, "outflow").sub(sum(expenses, "inflow"));
  const costFuel = openFuel.add(purchaseFuel).sub(closeFuel), costLub = openLub.add(purchaseLub).sub(closeLub), grossFuel = saleFuel.sub(costFuel), grossLub = saleLub.sub(costLub);
  const row = (Particulars: string, liquid: ReturnType<typeof money>, lubricant: ReturnType<typeof money>) => ({ Particulars, "Liquids (₹)": money(liquid).toString(), "Lubricants (₹)": money(lubricant).toString(), "Total (₹)": money(liquid.add(lubricant)).toString() });
  return [row("Opening Value", openFuel, openLub), row("Purchases", purchaseFuel, purchaseLub), row("Available Stock Value", openFuel.add(purchaseFuel), openLub.add(purchaseLub)), row("Closing Value", closeFuel, closeLub), row("Cost of Goods Sold", costFuel, costLub), row("Sales", saleFuel, saleLub), row("Gross Profit", grossFuel, grossLub), row("Stock Variation", sum(fuel, "variationamount"), sum(lubricants, "lossvalue")), row("Expenses", expense, money(0)), row("Net Profit", grossFuel.sub(expense), grossLub)];
}
