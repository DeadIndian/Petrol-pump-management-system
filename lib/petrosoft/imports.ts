import * as XLSX from "@e965/xlsx";
import { hasPermission, type PetrosoftActor } from "./auth";
import { executeAction, PetrosoftError } from "./actions";
import { fieldValue, formFor, jsonFields, moduleById, today, type PetrosoftFields } from "./catalog";
import { mastersFor } from "./queries";
import { rowFromImport } from "./rules";

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const conventional: Record<string, string> = {
  organization: "org_name", organizationname: "org_name", customername: "cust_name", custrepresentname: "cust_name", tin: "cust_gstno", gstno: "cust_gstno", gstin: "cust_gstno", phoneno: "phone_no", phonenumber: "phone_no", mobile: "phone_no", mobilenumber: "phone_no", address: "org_address", email: "eml", openingbalance: "open_bal", openingdetails: "open_bal", balancecutoffdate: "open_dt", creditlimit: "credit_limit", discount: "discount", vehicleno: "vehi_no", vehiclenumber: "vehi_no", billno: "credit_billno", receiptno: "credit_billno", indentno: "indent_no", trackno: "indent_no", description: "desc", testqty: "test_qty", openingreading: "open_read", closingreading: "close_read", netqty: "quantity", netquantity: "quantity", salequantity: "quantity", price: "price", quantity: "quantity", quantitylts: "quantity", qty: "quantity", cost: "amount", paidamount: "paid_amt", receivedamount: "paid_amt", mischarges: "batta_amt", misccharges: "batta_amt", saleamount: "amount", amount: "amount", paymentmode: "re_type", mode: "re_type",
};
export function importTarget(module: string, action: string) {
  if (/uploadCredits/i.test(action)) return "credit-sales";
  if (/uploadSales/i.test(action)) return "meter-sales";
  if (/uploadSwipes/i.test(action)) return "swipes";
  if (/uploadExpenses/i.test(action)) return "expenses";
  if (/uploadRecover/i.test(action)) return "recoveries";
  return module;
}
export async function previewImport(actor: PetrosoftActor, file: File, moduleId: string, action: string, offeredMapping: PetrosoftFields = {}) {
  const target = importTarget(moduleId, action), module = moduleById.get(target);
  if (!module || !hasPermission(actor, target, "edit")) throw new PetrosoftError("Your role cannot import into this module.", 403);
  if (!file.size || file.size > 20 * 1024 * 1024) throw new PetrosoftError("Choose a CSV or spreadsheet smaller than 20 MB.", 413);
  const bytes = new Uint8Array(await file.arrayBuffer()), extension = file.name.split(".").pop()?.toLowerCase();
  if (!["csv", "xlsx", "xls", "txt"].includes(extension || "")) throw new Error("Choose a CSV, XLS, or XLSX file.");
  const book = XLSX.read(bytes, { type: "array", cellDates: true, raw: false, dense: true, sheetRows: 5002 });
  const sheet = book.Sheets[book.SheetNames[0]], cells = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false, raw: false });
  if (cells.length < 2) throw new Error("The file must contain a header row and at least one data row.");
  if (cells.length > 5001) throw new Error("Import at most 5,000 rows at a time.");
  const headers = cells[0].map(value => String(value ?? "").replace(/^\uFEFF/, "").trim());
  if (headers.length > 150) throw new Error("The file has too many columns.");
  const saveForm = module.forms.find(form => form.operation === "save") || formFor(module), schema = saveForm?.fields || [];
  const mapping: Record<string, string> = {};
  for (const header of headers) {
    const offered = offeredMapping[header], automatic = schema.find(field => normalize(field.name) === normalize(header) || normalize(field.label.replace(/\*$/, "")) === normalize(header));
    mapping[header] = typeof offered === "string" ? offered : automatic?.name.replace(/\[\]$/, "") || conventional[normalize(header)] || header.replace(/\s+/g, "_").toLowerCase();
  }
  const masters = await mastersFor(actor.workspaceId), errors: { row: number; message: string }[] = [];
  const lookup = (relation: string, offered: string, row: number) => {
    if (!offered || offered === "0") return offered;
    const matched = (masters[relation] || []).find(entry => entry.externalId === offered || entry.name.trim().toLowerCase() === offered.trim().toLowerCase());
    if (!matched) { errors.push({ row, message: `Unknown ${relation.replace(/-/g, " ")}: ${offered}` }); return offered; }
    return matched.externalId;
  };
  const rows = cells.slice(1).filter(row => row.some(value => String(value).trim())).map((values, index) => {
    const parsed: PetrosoftFields = { __headers: headers, __cells: values.map(value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "")) };
    headers.forEach((header, column) => { if (mapping[header]) parsed[mapping[header]] = parsed.__cells instanceof Array ? parsed.__cells[column] : ""; });
    const row = rowFromImport(module, parsed);
    const date = fieldValue(row, ["_date", "insert_date", "join_dt", "date"], today().toISOString().slice(0, 10));
    if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(date)) { const [day, month, year] = date.split(/[-/]/); row._date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`; }
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(new Date(date).getTime())) row._date = new Date(date).toISOString().slice(0, 10);
    row.insert_date = row._date || date; row.join_dt ||= row.insert_date; row.trans_dt ||= row.insert_date;
    if (target === "customers") { row.org_name ||= row.name; row.cust_name ||= row.org_name; row.int_run ||= "No"; }
    if (target === "employees") { row.emp_name ||= row.name; row.designation ||= "DSM"; row.salary_type ||= "Per Duty"; row.salary ||= "0"; row.emp_ph_no ||= row.phone_no; row.emp_addrs ||= row.org_address; }
    if (target === "fuel-products") row.liqpro_name ||= row.name;
    if (target === "lubricants") row.pro_name ||= row.name;
    if (module.kind !== "master") {
      if (row.__customerName || row.org_name || row.customer) { row.customer_id = lookup("customers", fieldValue(row, ["__customerName", "org_name", "customer"]), index + 2); row.organiz = row.customer_id; row.rec_organiz = row.customer_id; }
      if (row.__productName || row.product) { row.product = lookup(/lubricant/.test(target) ? "lubricants" : "fuel-products", fieldValue(row, ["__productName", "product"]), index + 2); }
      if (row.__employeeName || row.employee) row.employee = lookup("employees", fieldValue(row, ["__employeeName", "employee"]), index + 2);
      if (row.__vendorName || row.vendor) row.vendor = lookup("vendors", fieldValue(row, ["__vendorName", "vendor"]), index + 2);
      if (row.nozzle) row.nozzle_id = lookup("nozzles", String(row.nozzle), index + 2);
    }
    if (target === "credit-sales") { row.credsale_emp ||= row.employee; row.qnty ||= row.quantity; row.cost ||= row.amount; }
    if (target === "recoveries") { row.rec_emp ||= row.employee; row.paid_amt ||= row.amount; row.re_type ||= "Cash"; }
    if (target === "swipes") { row.swipesale_emp ||= row.employee; row.swipe_amt ||= row.amount; row.swipe_bank = lookup("swipe-machines", fieldValue(row, ["swipe_bank", "swipe", "machine"]), index + 2); }
    delete row.__headers; delete row.__cells; delete row.__customerName; delete row.__productName; delete row.__employeeName; delete row.__vendorName;
    return row;
  });
  return { module: target, formIndex: saveForm?.index, headers, mapping, fields: schema.filter(field => !["file", "password", "hidden"].includes(field.type)).map(field => ({ name: field.name.replace(/\[\]$/, ""), label: field.label, required: field.required })), rows, errors: errors.slice(0, 100), total: rows.length };
}
export async function commitImport(actor: PetrosoftActor, module: string, offeredRows: unknown, formIndex?: number) {
  if (!Array.isArray(offeredRows) || !offeredRows.length || offeredRows.length > 5000) throw new Error("Import between 1 and 5,000 rows.");
  const rows = offeredRows.map(jsonFields);
  return executeAction(actor, { module, formIndex, fields: { rows, imported: true } });
}
