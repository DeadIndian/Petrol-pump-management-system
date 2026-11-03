import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { chromium } from "playwright-core";
import type { PetrosoftActor } from "./auth";
import { fieldValue, jsonFields, type PetrosoftFields } from "./catalog";
import { escapeHtml } from "./render";
import type { ReportResult, ReportRow, ReportSection } from "./report-data";

export const normalizeHeading = (value: string) => value.toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]/g, "");
const aliases: Record<string, string[]> = {
  date: ["date", "insert_date", "trans_dt"], invoicedate: ["date"], purchasedate: ["date"], creditdate: ["date"], recoverydate: ["date"], invdt: ["date"], suppdate: ["date"],
  fromdatetodate: ["period"], dateperiod: ["dateperiod", "month"], month: ["month"],
  refno: ["refno", "ref_no", "number"], referanceno: ["refno", "number"], referenceno: ["refno", "number"], invno: ["invoice", "refno", "number"], invoiceno: ["invoice", "refno"], invoicenumber: ["invoice", "refno"], supplierinvno: ["invoice", "refno"], suppliedinvoiceno: ["invoice", "refno"], receiptno: ["refno", "credit_billno", "billno"], billno: ["refno", "billno"], invbillno: ["refno"], indent: ["indent_no", "ind_no"], indentno: ["indent_no", "ind_no"], trackno: ["indent_no", "ind_no"], recno: ["refno", "number"], paymentno: ["refno", "number"],
  customer: ["customer", "organization", "name"], customername: ["customer", "cust_name", "name"], organization: ["customer", "organization", "name"], organizationname: ["customer", "organization", "name"], receivername: ["receiver", "customer", "name"], partyacname: ["vendor", "customer", "name"], ptyname: ["vendor", "customer", "name"], creditorname: ["creditorname", "name"], vendor: ["vendor", "name"], name: ["name", "customer", "product"], nameofitem: ["product"], itemname: ["product", "name"], productname: ["product", "product_name", "name"], product: ["product", "product_name"], description: ["description", "descript", "product"], items: ["product"], employee: ["employee", "employee_name"], employeename: ["employee", "employee_name"], empname: ["employee", "employee_name"], pump: ["pump", "pump_no", "pump_name"], nozzle: ["nozzle", "nozzle_name"], nozzel: ["nozzle", "nozzle_name"], tank: ["tank", "tank_name", "tank_no"], bowsername: ["bowsername", "bowser_name"],
  mobile: ["mobile", "phone_no", "phone"], mobileno: ["mobile", "phone_no"], mobilenumber: ["mobile", "phone_no"], vehicleno: ["vehicle", "vehi_no"], vehiclenum: ["vehicle", "vehi_no"], quantity: ["quantity"], qty: ["quantity"], litres: ["litres", "quantity"], totalquantity: ["quantity"], uom: ["uqc"], unit: ["uqc"], uqc: ["uqc"],
  rate: ["price", "rate", "taxrate"], unitprice: ["price", "rate"], price: ["price", "rate"], salerate: ["salerate", "price"], purchaserate: ["purchaserate"], variationrate: ["variationrate"],
  amount: ["amount"], total: ["total", "total_amount", "amount"], totalcost: ["total", "amount"], totalamount: ["total", "amount"], netamt: ["total", "amount"], invoicevalue: ["total", "amount"], totalinvoicevalue: ["total", "amount"], invoiceamount: ["invoiceamount", "total", "amount"], billamount: ["basicamount", "amount"], saleamount: ["saleamount", "amount"], received: ["mode"], receivedlt: ["received", "quantity"], receivedamount: ["receivedamount", "amount"], discount: ["discount"], cashdiscount: ["cashdisc", "cashdisocunt"], misccharges: ["misccharges", "misc_charges", "batta_amt"],
  collectable: ["collectable", "total", "amount"], payment: ["payment", "recovery"], paidamount: ["paidamount", "recovery"], recoveryamount: ["recoveryamount", "payment"], dueamount: ["dueamount", "balance"], balance: ["balance"], balanceamount: ["balance"], closingbal: ["closingbalance", "balance"], openingbal: ["openingbalance"], openingbalance: ["openingbalance"], closingbalance: ["closingbalance", "balance"], outstanding: ["outstanding", "balance"], creditlimit: ["creditlimit"], limit: ["limit", "creditlimit"], lastpaid: ["lastpaiddays", "lastpaiddate"],
  tax: ["tax"], gstno: ["gstin"], gstin: ["gstin"], gstinuinofrecipient: ["gstin"], gstinuin: ["gstin"], hsn: ["hsn"], hsncode: ["hsn"], hsnsac: ["hsn"], gst: ["gst"], gstapplicable: ["gstapplicable"], taxper: ["gst", "taxrate"], taxrate: ["taxrate", "gst"], gstpercent: ["gst"], applicableoftaxrate: ["applicabletaxrate"], placeofsupply: ["placeofsupply"], stateofsupply: ["placeofsupply"], sateofsupply: ["placeofsupply"], taxablevalue: ["taxablevalue", "basicamount"], taxableamt: ["taxablevalue", "basicamount"], taxableamount: ["taxablevalue", "basicamount"], taxable: ["taxablevalue", "taxable"], totaltaxablevalue: ["taxablevalue"], igst: ["igst"], igstamt: ["igst"], totalintegratedtax: ["igst"], integratedtaxamount: ["igst"], sgst: ["sgst"], sgstamt: ["sgst"], totalstatetax: ["sgst"], stateuttaxamount: ["sgst"], cgst: ["cgst"], cgstamt: ["cgst"], totalcentraltax: ["cgst"], centraltaxamount: ["cgst"], cess: ["cess"], totalcess: ["cess"], cessamount: ["cess"], tcsothertxs: ["tcs", "othertxs"], sslflfr: ["lfr"], vat: ["vatamount"], vatamount: ["vatamount"], vatamountdc: ["vatamount"], basicamount: ["basicamount", "taxablevalue"], otheramt: ["misccharges", "othertxs"], narration: ["description"], salesledger: ["salesledger"], purchaseledger: ["purchaseledger"], vchtype: ["vouchertype", "type"],
  openingstock: ["openingstock", "openstock", "open_stock"], openstock: ["openstock", "openingstock", "open_stock"], receipt: ["receipt"], receipts: ["receipts", "receipt"], stockreceipt: ["stockreceipt", "receipt"], stockreciept: ["stockreceipt", "receipt"], totalstock: ["totalstock", "total_stk"], actualstock: ["actualstock", "close_stock"], currentstock: ["currentstock", "dip_stock"], dipstock: ["dipstock", "dip_stock"], closedstock: ["actualstock", "close_stock"], closingstock: ["closingstock", "close_stock"], closingvalue: ["closingvalue"], variation: ["variation", "stk_variation"], vari: ["variation", "stk_variation"], variationstock: ["variationstock", "stk_variation"], variationamount: ["variationamount", "vari_amnt"], metersales: ["metersales", "meter_sale"], totalsale: ["totalsale", "meter_sale"], netmetersale: ["netmetersale", "meter_sale"], dipssales: ["dipsales"], actualsales: ["actualsales"], saleqty: ["saleqty", "quantity"], saleamt: ["amount"], creditsaleqty: ["creditsaleqty"], creditsaleamount: ["creditsaleamount"],
  metersale: ["meter_sale"], lubssale: ["lubricant_sale"], lubsale: ["lubricant_sale"], recovery: ["recovery"], cashin: ["cash_in"], totalcash: ["total_cash"], swipe: ["swipe"], creditsale: ["credit"], saledisc: ["discount"], expenses: ["expenses"], recoverytrxn: ["bank_recovery"], shortage: ["shortage"], handcash: ["hand_cash"], openingcash: ["openingcash", "opening_cash"], closingcash: ["closingcash", "closing_cash"], cashinflow: ["cashinflow"], cashoutflow: ["cashoutflow"], inflow: ["cashinflow", "inflow"], outflow: ["cashoutflow", "outflow"],
  attendedstatus: ["attend_type"], remarks: ["attend_remark", "description"], presentdays: ["presents", "present_days"], absentdays: ["absents", "absent_days"], businessamt: ["businessamt", "sale"], collectedamt: ["collectedamt", "collected"],
  attachedbankvendor: ["attachedbankvendor"], batchid: ["batchid", "swp_billno"], swipecash: ["swipecash", "amount"], swipesaleamount: ["swipesaleamount"], settlementamount: ["settlementamount"], settlementcharges: ["settlementcharges"], closingamount: ["closingamount"], swipedescription: ["swipedescription", "description"],
  createddate: ["created_date", "date"], eventtime: ["event_time"], transactionid: ["entry_id", "id"], user: ["username", "createdBy"], fromlocation: ["from_location", "from_godown"], tolocation: ["to_location", "to_godown"], openqty: ["openingstock"], closing: ["closingstock"],
};

export function reportCell(row: ReportRow, heading: string, index: number): string | number {
  const label = normalizeHeading(heading);
  if (/^(?:sno|slno|sino|sln o)$/.test(label)) return index + 1;
  if (label === "lastpaid") return /date/i.test(heading) ? fieldValue(row, "lastpaiddate") : fieldValue(row, "lastpaiddays", "0");
  if (row[heading] !== undefined) return scalar(row[heading]);
  const normalizedKey = Object.keys(row).find(key => normalizeHeading(key) === label);
  if (normalizedKey) return scalar(row[normalizedKey]);
  const names = aliases[label];
  if (names) return fieldValue(row, names, numericHeading(heading) ? "0" : "");
  return numericHeading(heading) ? "0" : "";
}
function scalar(value: unknown): string | number { return typeof value === "number" ? value : typeof value === "boolean" ? value ? "Yes" : "No" : typeof value === "object" ? "" : String(value ?? ""); }
export function numericHeading(heading: string) {
  return /amount|amt|qty|quantity|litre|stock|balance|collectable|cost|discount|charges|price|rate|gain|taxable|\btax\b|gst|cess|tcs|tds|credit|debit|payment|paid|recovery|receipt|sale|swipe|cash|salary|loan|points|purchase|loss|shortage|variation|testing|^total$|^limit$/i.test(heading)
    && !/date|no\b|num|name|type|mode|description|ledger|gstin|gst no|h s n|hsn|source|account|bill|invoice|receipt no|customer/i.test(heading);
}
export function projectedReport(report: ReportResult) {
  return { ...report, sections: report.sections.map(section => ({ ...section, cells: section.rows.map((row, index) => section.columns.map(column => reportCell(row, column, index))) })) };
}
const reportCss = `body{margin:0;color:#222;background:#fff;font:13px/1.5 Roboto,Arial,sans-serif}#content{padding:10px 15px}.header-container{display:flex;align-items:center;justify-content:center;padding:12px 25px;margin:10px 0 0;box-shadow:0 0 4px #885db3;border-radius:6px 6px 0 0;text-align:center;color:#25004f}.header-container h1{font-size:21px;margin:0}.header-container p{margin:0;font-weight:700}.print-top-text{display:flex;justify-content:space-between;gap:15px;padding:15px 0}.print-middile{margin:0 0 20px}.report-title{margin:12px 0;font-size:17px;text-align:center}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #aaa;padding:5px 10px;vertical-align:top}th{background:#f4f4f4;font-weight:700;text-align:left}.numeric{text-align:right;font-variant-numeric:tabular-nums}.empty{text-align:center;padding:18px}tfoot td{font-weight:700}.report-scroll{overflow:auto}button{padding:6px 16px;cursor:pointer}section{margin-bottom:22px;break-inside:auto}thead{display:table-header-group}tr{break-inside:avoid}@media print{.hidden-print{display:none!important}#content{padding:0}.header-container{box-shadow:none;border:1px solid #725e87}.report-scroll{overflow:visible}table{font-size:10px}th,td{padding:4px 6px}}`;

export function reportTable(section: ReportSection) {
  const columns = section.columns.filter(column => column.trim());
  return `<section><h2 class="report-title">${escapeHtml(section.title)}</h2><div class="report-scroll"><table class="table table-bordered"><thead><tr>${columns.map(column => `<th scope="col">${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${section.rows.length ? section.rows.map((row, index) => `<tr>${columns.map(column => `<td${numericHeading(column) ? ' class="numeric"' : ""}>${escapeHtml(reportCell(row, column, index))}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${columns.length}" class="empty">No records found</td></tr>`}</tbody></table></div></section>`;
}
export function reportHtml(report: ReportResult, actor: PetrosoftActor, printable = false) {
  const settings = jsonFields(actor.workspace.settings);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(report.title)}</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' 'self'; font-src 'self' data:; img-src 'self' data:; script-src 'self'; base-uri 'none'"><style>${reportCss}</style>${printable ? "" : '<link rel="stylesheet" href="/petrosoft-assets/fonts.css">'}</head><body><main id="content"><div class="print-grid"><div class="print-border"><div class="header-container"><div><h1>${escapeHtml(actor.workspace.name)}</h1>${[settings.company_address1, settings.company_address2, settings.gst_no || settings.gstn, settings.contact].filter(Boolean).map(line => `<p>${escapeHtml(line)}</p>`).join("")}</div></div><div class="print-top-text"><span>Date Range : ${escapeHtml(report.from)} To ${escapeHtml(report.to)}</span><span>${escapeHtml(report.title)}</span></div>${report.sections.map(reportTable).join("")}</div></div></main></body></html>`;
}

function spreadsheetValue(value: string | number) {
  if (typeof value === "number") return value;
  if (/^-?\d+(?:\.\d+)?$/.test(value) && value.length < 15 && !/^0\d/.test(value)) return Number(value);
  return value;
}
export async function reportXlsx(report: ReportResult) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Petrosoft";
  report.sections.forEach((section, sectionIndex) => {
    const name = section.title.replace(/[\\/*?:[\]]/g, " ").slice(0, 25) || "Report";
    const sheet = workbook.addWorksheet(sectionIndex ? `${name} ${sectionIndex + 1}` : name);
    const columns = section.columns.filter(Boolean);
    sheet.addRow(columns);
    const header = sheet.getRow(1); header.font = { bold: true }; header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E2F0" } };
    section.rows.forEach((row, index) => sheet.addRow(columns.map(column => spreadsheetValue(reportCell(row, column, index)))));
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: "A1", to: { row: 1, column: columns.length } };
    sheet.columns.forEach((column, index) => { column.width = Math.min(38, Math.max(14, columns[index].length + 2)); if (numericHeading(columns[index])) column.numFmt = "#,##0.00"; });
  });
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
export function reportCsv(report: ReportResult) {
  const cell = (value: string | number) => `"${String(value).replace(/^[=+@-](?!\d)/, "'$&").replace(/"/g, '""')}"`;
  return "\uFEFF" + report.sections.map(section => [cell(section.title), section.columns.map(cell).join(","), ...section.rows.map((row, index) => section.columns.map(column => cell(reportCell(row, column, index))).join(","))].join("\r\n")).join("\r\n\r\n");
}
let pdfActive = 0;
export async function reportPdf(report: ReportResult, actor: PetrosoftActor, landscape = false) {
  if (pdfActive >= 2) throw new Error("Two PDF exports are running. Try again in a moment.");
  pdfActive++;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.PETROSOFT_CHROME || "/usr/bin/google-chrome", headless: true, args: ["--disable-background-networking", "--disable-extensions", "--no-sandbox"] });
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    let html = reportHtml(report, actor, true);
    try { const font = await readFile(join(process.cwd(), "public/petrosoft-assets/fonts/roboto-latin-regular.woff2")); html = html.replace("<style>", `<style>@font-face{font-family:Roboto;src:url(data:font/woff2;base64,${font.toString("base64")})}`); } catch { /* The portable PDF uses Arial when the local font is unavailable. */ }
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.emulateMedia({ media: "print" });
    return new Uint8Array(await page.pdf({ format: "A4", landscape, printBackground: true, margin: { top: "10mm", right: "8mm", bottom: "12mm", left: "8mm" } }));
  } finally { await browser?.close(); pdfActive--; }
}
export function tallyXml(report: ReportResult, settings: PetrosoftFields = {}) {
  const xml = (value: unknown) => escapeHtml(value).replace(/&#39;/g, "&apos;");
  const company = fieldValue(settings, ["tally_company", "company_name"]);
  const vouchers = report.sections.flatMap(section => section.rows).map(row => {
    const amount = fieldValue(row, ["total", "amount"], "0"), date = fieldValue(row, "date").replace(/-/g, ""), customer = fieldValue(row, ["vendor", "customer", "name"]), ledger = fieldValue(row, ["purchaseledger", "salesledger"], row.vendor ? "Purchases" : "Sales"), purchase = Boolean(row.vendor);
    return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${purchase ? "Purchase" : "Sales"}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${xml(date)}</DATE><VOUCHERTYPENAME>${purchase ? "Purchase" : "Sales"}</VOUCHERTYPENAME><VOUCHERNUMBER>${xml(fieldValue(row, ["invoice", "refno", "number"]))}</VOUCHERNUMBER><PARTYLEDGERNAME>${xml(customer)}</PARTYLEDGERNAME><NARRATION>${xml(row.description)}</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(customer)}</LEDGERNAME><ISDEEMEDPOSITIVE>${purchase ? "No" : "Yes"}</ISDEEMEDPOSITIVE><AMOUNT>${purchase ? "" : "-"}${xml(amount)}</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${purchase ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${purchase ? "-" : ""}${xml(amount)}</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${xml(company)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>${vouchers}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}
