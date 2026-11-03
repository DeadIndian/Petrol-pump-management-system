import { Prisma } from "@prisma/client";
import { dateValue, fieldNumber, fieldValue, jsonFields, type ModuleSchema, type PetrosoftFields, today } from "./catalog";

export const Decimal = Prisma.Decimal;
export function decimal(value: unknown) {
  const text = String(value ?? 0).replace(/[,₹]/g, "").trim();
  const number = new Decimal(text || 0);
  if (!number.isFinite() || number.abs().gt("99999999999999")) throw new Error("Enter a valid number within the supported range.");
  return number;
}
export function money(value: unknown) { return decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP); }
export function quantity(value: unknown) { return decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP); }
export function positive(value: unknown, label: string, allowZero = false) {
  const number = decimal(value);
  if (allowZero ? number.lt(0) : number.lte(0)) throw new Error(`${label} must be ${allowZero ? "zero or a positive number" : "a positive number"}.`);
  return number;
}

export const NAME_KEYS: Record<string, string[]> = {
  "fuel-products": ["liqpro_name", "prod_name", "name"], lubricants: ["pro_name", "prod_name", "name"],
  customers: ["org_name", "organization", "cust_name", "name"], employees: ["emp_name", "name"],
  vendors: ["ven_comp", "vend_name", "name"], "swipe-machines": ["swipe_name", "name"],
  "expense-types": ["exp_name", "name"], "business-parties": ["crd_name", "name"],
  tanks: ["tank_name", "tank_no", "name"], "pump-settings": ["pump_name", "name"],
  "duty-shifts": ["shift_type", "shift_name", "workshift_name", "name"], "business-shifts": ["shift_name", "busi_shift", "name"],
  guests: ["g_name", "cust_name", "guest_name", "gust_name", "name"], gifts: ["emp_name", "gift_name", "name"],
  "loyalty-tiers": ["tier_name", "name"], roles: ["role_name", "user_role", "name"], users: ["user_name", "username", "uname", "name"],
  denominations: ["d_val", "denom", "denomination", "name"], parameters: ["cCode", "param_name", "parameter_name", "name"],
  "expiry-items": ["item_name", "expiry_item", "expitem_name", "name"], "expiry-categories": ["cat_name", "name"],
  nozzles: ["noz_name", "nozzle_name", "name"], vehicles: ["vehicle_no", "vehi_no", "name"],
  "employee-loans": ["loan_name", "name"], "employee-benefits": ["earn_type", "name"],
  "expiry-renewals": ["item_number", "name"], bowsers: ["b_name", "name"], "bowser-nozzles": ["nozzle_name", "name"],
  "customer-discounts": ["product", "name"], "customer-interest": ["customer_id", "name"], calibration: ["tank_no", "name"],
};

export const PRODUCT_KEYS = ["product", "prod_code", "prod_id", "product_id", "pro_name", "pro_name2", "lub_name", "pur_proname1", "gname", "gifts", "stock_prod", "prodc"];
export const CUSTOMER_KEYS = ["organiz", "rec_organiz", "credit_org", "org_input", "customer_id", "cust_id", "org_id", "organization", "org_name"];
export const EMPLOYEE_KEYS = ["credsale_emp", "rec_emp", "swipesale_emp", "employees", "emp_id", "employee_id", "employee", "emp_assign", "rec_emp1", "noz_emp", "prodsale_emp", "sale_emp", "employeeName"];
export const VENDOR_KEYS = ["liq_vendor", "lub_vendor", "vend_name", "vendor_id", "ven_comp", "paidvend_name", "vendor", "Vendor", "vend", "expvendtype_field"];
export const BANK_KEYS = ["payment_bank", "banktype_field", "bank_id", "bank_name", "expbanktype_field", "swipe_bank", "bank", "coll_name"];
export function referenceValue(fields: PetrosoftFields, names: string[], fallback = "") {
  for (const name of names) { const value = fieldValue(fields, name); if (value && !["0", "all", "All", "unassigned"].includes(value)) return value; }
  return fallback;
}
export const DATE_KEYS = ["_date", "insert_date", "pur_date", "assigninsert_date", "recv_date", "date_input", "trans_dt", "trans_date", "trxn_date", "swipe_date", "exp_date", "sale_date", "payment_date", "join_dt", "date", "dt", "g_date", "date_attend", "salary_date", "Loss_date"];
export const RATE_KEYS = ["price", "purrate", "sale_rate", "pro_rate1", "pur_prorate", "pro_rate", "prod_rate", "rate", "rate_per_liter", "sale_amt"];
export const QUANTITY_KEYS = ["qnty", "pro_qty1", "pur_proqty", "pro_qty", "qty", "quantity", "qunt", "sale_qty", "net_sale", "net_qty", "pro_qnty", "lubsale_qty", "pro_qunt", "quantity_delivered"];
export const AMOUNT_KEYS = ["paid_amt", "received_amt", "recamnt", "swipe_amt", "swipe_amnt", "swipe_amount", "exp_amt", "exp_amnt", "pro_amt1", "trans_amnt", "less_amnt", "amount", "credit_amt", "cost", "total_amt", "total_amount", "purcost", "purtotal", "sale_amount", "tot_recoveramnt", "trans_amount", "trxn_amt", "invoice_tot", "tot_amt"];

const PRIMARY_ARRAYS: Record<string, string[]> = {
  "fuel-products": ["liqpro_name"], lubricants: ["pro_name"], employees: ["emp_name"], "swipe-machines": ["swipe_name"],
  "expense-types": ["exp_name"], "pump-settings": ["pump_name"], "fuel-purchases": ["prod_code"],
  "lubricant-purchases": ["pur_proname1", "pro_name", "prod_code", "prod_id"], "other-purchases": ["pur_proname1"], "credit-sales": ["organiz"], recoveries: ["rec_organiz"],
  swipes: ["swipesale_emp", "swipe_name", "swp_name"], expenses: ["employees", "exp_type"],
  "lubricant-sales": ["pro_name2", "pro_name", "lub_name"], "day-assignments": ["emp_assign"],
  "loyalty-tiers": ["tier_name"], "loyalty-points": ["tier_name"], gifts: ["emp_name"], "guest-sales": ["guest_id", "mobileno"],
  "employee-recoveries": ["emp_id"], "gift-purchases": ["gname"], "gift-sales": ["guest_cust"],
  "business-transactions": ["partytype"], "vendor-transactions": ["Vendor"], "handling-loss": ["product"],
  "lubricant-loss": ["pro_name2"], brs: ["partytype"], vrs: ["partytype"], "expiry-categories": ["cat_name"], denominations: ["d_val"],
};

export function baseModule(module: string) {
  return module.startsWith("bowser-") ? ({ "bowser-sales": "meter-sales" }[module] || module.replace("bowser-", "")) : module;
}

export function rowsFromForm(module: ModuleSchema, fields: PetrosoftFields): PetrosoftFields[] {
  if (Array.isArray(fields.rows)) return (fields.rows as unknown[]).map(row => ({ ...fields, ...jsonFields(row), rows: undefined }));
  if (module.id === "daily-rates" || module.id === "shift-sheet") {
    const rates = Object.entries(fields).filter(([key]) => /^new_rate\[\w+\]$/.test(key));
    if (rates.length) return rates.map(([key, rate]) => {
      const id = key.slice(9, -1);
      return { ...fields, product: id, new_rate: rate, cls_rate: fields[`cls_rate[${id}]`] || rate, old_rate: fields[`oid_ratre[${id}]`] || "0" };
    });
  }
  if (baseModule(module.id) === "meter-sales") {
    const grouped = Object.keys(fields).filter(key => /^noz_name_\w+\[\]$/.test(key));
    if (grouped.length) return grouped.flatMap(key => {
      const product = key.replace(/^noz_name_/, "").replace(/\[\]$/, "");
      const ids = Array.isArray(fields[key]) ? fields[key] as unknown[] : [fields[key]];
      return ids.map((id, index) => {
        const get = (base: string) => {
          const value = fields[`${base}_${product}[]`];
          return Array.isArray(value) ? value[index] : value;
        };
        return { ...fields, product, nozzle_id: id, nozzle: id, pump_id: get("pump_id"), tank_no: get("noztank_no"),
          sale_pump: get("sale_pump"), open_read: get("open_read"), close_read: get("close_read"),
          test_qty: get("noz_test"), price: get("sale_rate"), employee: get("noz_emp") };
      }).filter(row => row.close_read !== "" && row.close_read !== undefined);
    });
  }
  const preferred = PRIMARY_ARRAYS[baseModule(module.id)] || [];
  let primary = preferred.map(key => `${key}[]`).find(key => Array.isArray(fields[key]));
  if (!primary && module.kind !== "master" && module.id !== "settlements") {
    primary = Object.keys(fields).find(key => /\[\]$/.test(key) && Array.isArray(fields[key]) && !/denom|upload|file|image|trans_type|exp_type/.test(key));
  }
  if (!primary || ["customers", "tanks", "guests", "vendors", "settlements", "organization", "settings", "print-templates", "users"].includes(module.id)) return [fields];
  const list = fields[primary] as unknown[];
  const bases: Record<string, number> = {};
  for (const key of Object.keys(fields)) {
    const match = key.match(/^(\w+)\[(\d+)\](?:\[\])?$/);
    if (match) bases[match[1]] = Math.min(bases[match[1]] ?? Number(match[2]), Number(match[2]));
  }
  return list.map((_, index) => {
    const row: PetrosoftFields = {};
    for (const [key, value] of Object.entries(fields)) {
      if (Array.isArray(value) && key.endsWith("[]") && !/\[\d+\]\[\]$/.test(key)) row[key.slice(0, -2)] = value[index] ?? "";
      else if (/\[\d+\](?:\[\])?$/.test(key)) {
        const match = key.match(/^(\w+)\[(\d+)\](?:\[\])?$/);
        if (match && Number(match[2]) === index + bases[match[1]]) row[match[1]] = value;
      } else row[key] = value;
    }
    return row;
  }).filter(row => fieldValue(row, primary!.slice(0, -2)) !== "");
}

export function recordDate(module: ModuleSchema, fields: PetrosoftFields) {
  for (const key of DATE_KEYS) {
    const value = fieldValue(fields, key);
    if (value) {
      try { return dateValue(value); } catch { if (key !== "frm_dt" && key !== "join_dt") throw new Error("Choose a valid transaction date."); }
    }
  }
  for (const [key, value] of Object.entries(fields)) {
    if (!/date|_dt$/.test(key) || /to_dt|open_dt/.test(key)) continue;
    try { return dateValue(Array.isArray(value) ? value[0] : value); } catch { /* Try the next explicit date. */ }
  }
  if (module.kind === "master" || module.kind === "settings" || ["sale-invoices", "generated-invoices", "statements", "brs-generation", "vrs-generation", "payroll", "loyalty-points"].includes(module.id)) return today();
  throw new Error("Choose the transaction date before saving.");
}

export interface NormalizedRow {
  name: string; date: Date; amount: Prisma.Decimal; quantity: Prisma.Decimal; rate: Prisma.Decimal;
  fields: PetrosoftFields; status: string;
}

export function normalizeRow(module: ModuleSchema, input: PetrosoftFields): NormalizedRow {
  const fields = { ...input };
  const names = NAME_KEYS[module.id] || ["description", "desc", "name"];
  let name = fieldValue(fields, names);
  if (!name && module.kind === "master") {
    const candidate = module.forms.flatMap(form => form.fields).find(field => field.type === "text" && !/date|_dt|rate|amount|qty|quantity|phone|mobile|gst|vat|tcs|lfr|stock|hsn|password|email|num/.test(field.name));
    if (candidate) name = fieldValue(fields, candidate.name);
  }
  if (module.kind === "master" && !name && !["loyalty-points", "pump-settings", "denominations"].includes(module.id)) throw new Error("Enter the name before saving.");
  let amount = money(fieldValue(fields, AMOUNT_KEYS, "0"));
  let count = quantity(fieldValue(fields, QUANTITY_KEYS, "0"));
  let rate = quantity(fieldValue(fields, RATE_KEYS, "0"));
  const base = baseModule(module.id);
  if (module.id === "bowser-sales" && fieldValue(fields, "bowser")) {
    count = positive(fieldValue(fields, ["metersale", "quantity"], "0"), "Meter sale", true);
    rate = positive(fieldValue(fields, ["price", "rate"], "0"), "Sale price", true);
    amount = money(count.mul(rate));
    fields.closing = quantity(decimal(fieldValue(fields, "opening", "0")).add(fieldValue(fields, "receipt", "0")).sub(count)).toString();
  } else if (base === "meter-sales") {
    const opening = positive(fieldValue(fields, ["open_read", "opening_reading"], "0"), "Opening reading", true);
    const closing = positive(fieldValue(fields, ["close_read", "closing_reading"], "0"), "Closing reading", true);
    const test = positive(fieldValue(fields, ["test_qty", "noz_test", "testing"], "0"), "Test quantity", true);
    if (closing.lt(opening)) throw new Error("Closing meter reading cannot be lower than the opening reading.");
    const gross = closing.sub(opening);
    if (test.gt(gross)) throw new Error("Test quantity cannot exceed the metered quantity.");
    count = quantity(gross.sub(test));
    rate = positive(rate, "Sale price");
    amount = money(count.mul(rate));
    Object.assign(fields, { gross_qty: gross.toString(), test_qty: test.toString(), net_qty: count.toString(), quantity: count.toString(), cost: amount.toString(), price: rate.toString() });
  } else if (base === "daily-rates" || module.id === "shift-sheet") {
    rate = positive(fieldValue(fields, "new_rate", "0"), "Opening sale rate");
    const closing = positive(fieldValue(fields, "cls_rate", rate.toString()), "Closing sale rate");
    fields.var_amt = closing.sub(rate).toString();
    fields.cls_rate = closing.toString();
  } else if (["credit-sales", "lubricant-sales", "guest-sales", "handling-loss", "lubricant-loss", "gift-sales"].includes(base)) {
    if (["credit-sales", "lubricant-sales", "guest-sales"].includes(base)) {
      rate = positive(rate, "Sale price");
      if (count.lte(0) && amount.gt(0)) count = quantity(amount.div(rate));
      count = positive(count, "Sale quantity");
      const discount = positive(fieldValue(fields, ["credit_discnt", "discount", "disc_amt", "disc", "discount_amount"], "0"), "Discount", true);
      const gross = money(count.mul(rate));
      if (discount.gt(gross)) throw new Error("Discount cannot exceed the sale amount.");
      const miscellaneous = positive(fieldValue(fields, ["batta_amt", "misc_charges", "miscellaneous"], "0"), "Miscellaneous charges", true);
      amount = money(gross.sub(discount).add(miscellaneous));
      Object.assign(fields, { gross_amount: gross.toString(), discount: discount.toString(), cost: gross.sub(discount).toString(), misc_charges: miscellaneous.toString(), total_amount: amount.toString(), quantity: count.toString(), price: rate.toString() });
    } else if (base !== "gift-sales") {
      count = positive(count, "Loss quantity");
      amount = money(count.mul(rate));
    }
  } else if (["fuel-purchases", "lubricant-purchases", "other-purchases", "lfr-invoices", "gift-purchases"].includes(base)) {
    if (count.gt(0) && rate.gt(0)) {
      const basic = money(count.mul(rate));
      const tax = money(fieldValue(fields, ["purvat", "vat_amount", "gst_amount"], "0"))
        .add(money(fieldValue(fields, "pur_sgst", "0"))).add(money(fieldValue(fields, "pur_cgst", "0"))).add(money(fieldValue(fields, "pur_igst", "0")));
      const tcs = money(fieldValue(fields, ["purtcs", "pur_tcs", "tcs_amount"], "0"));
      const other = money(fieldValue(fields, ["othertxs", "other_taxes"], "0"));
      const lfr = money(fieldValue(fields, ["lfr", "lfr_amount"], "0"));
      const dealer = money(fieldValue(fields, ["dealercomm", "dealer_commission"], "0"));
      const discount = money(fieldValue(fields, ["pur_disc", "discount"], "0"));
      if (discount.lt(0) || discount.gt(basic)) throw new Error("Purchase discount must be between zero and the basic amount.");
      const policy = jsonFields(fields._purchase_policy);
      amount = money(basic.sub(discount).add(tax).add(tcs).add(other)
        .add(policy.lfr_tot === "yes" ? lfr : 0).sub(policy.delar_comm === "yes" ? dealer : 0));
      Object.assign(fields, { basic_amount: basic.toString(), purcost: basic.toString(), taxable_amount: basic.sub(discount).toString(), total_amount: amount.toString(), quantity: count.toString(), rate: rate.toString() });
    }
    positive(amount, "Invoice amount");
  } else if (base === "recoveries" || base === "employee-recoveries") {
    amount = positive(fieldValue(fields, ["paid_amt", "recamnt", "received_amt", "amount", "emp_cash", "cash_rec_amt"], "0"), "Received amount", base === "employee-recoveries");
    fields.discount = positive(fieldValue(fields, ["rec_disc_amt", "discount"], "0"), "Recovery discount", true).toString();
  } else if (["swipes", "expenses", "business-transactions", "vendor-transactions"].includes(base)) {
    const candidates = base === "swipes" ? ["swipesale_amnt", "swipe_amnt", "swipe_amount", "swipe_amt", "amount", "paid_amt"]
      : base === "expenses" ? ["exp_amt", "exp_amnt", "paid_amount", "amount", "amt"]
        : ["trans_amnt", "trans_amount", "trxn_amt", "amount", "amt", "paid_amt"];
    amount = positive(fieldValue(fields, candidates, amount.toString()), "Transaction amount");
  }
  const status = fieldValue(fields, "status", "active");
  return { name, date: recordDate(module, fields), amount: money(amount), quantity: quantity(count), rate: quantity(rate), fields, status };
}

export interface LedgerPosting { entityType: string; entityId: string; debit?: Prisma.Decimal | string | number; credit?: Prisma.Decimal | string | number; quantity?: Prisma.Decimal | string | number; description?: string }
const post = (entityType: string, entityId: string, debit: Prisma.Decimal | string | number = 0, credit: Prisma.Decimal | string | number = 0, count: Prisma.Decimal | string | number = 0): LedgerPosting => ({ entityType, entityId, debit, credit, quantity: count });

export function paymentAccount(fields: PetrosoftFields, prefix = "") {
  const explicitBank = referenceValue(fields, ['bank']);
  const mode = fieldValue(fields, [`${prefix}re_type`, `${prefix}mode`, "exp_paytype", "collection_mode", "coll_type", "payment_mode", "paymode"], explicitBank && explicitBank !== 'Cash' ? 'Bank' : "Cash");
  const type = /swipe|pos/i.test(mode) ? "swipe" : /bank|upi|cheque/i.test(mode) ? "bank" : /vendor|card/i.test(mode) ? "vendor" : /party|creditor/i.test(mode) ? "party" : "cash";
  const id = type === "cash" ? "cash" : referenceValue(fields,
    type === "bank" ? BANK_KEYS : type === "swipe" ? ["swipe_bank", "banktype_field", "recbank_type", "coll_name"]
      : type === "party" ? ["partyname_field", "party_id", "coll_name"] : VENDOR_KEYS, "unassigned").split("|")[0];
  return { type, id };
}

export function ledgerFor(module: ModuleSchema, row: NormalizedRow): LedgerPosting[] {
  const fields = row.fields, base = baseModule(module.id), amount = row.amount;
  const customer = referenceValue(fields, CUSTOMER_KEYS), employee = referenceValue(fields, EMPLOYEE_KEYS), product = referenceValue(fields, PRODUCT_KEYS);
  const vendor = referenceValue(fields, VENDOR_KEYS).split("|")[0], account = paymentAccount(fields);
  const result: LedgerPosting[] = [];
  if (module.kind === "master") {
    const opening = money(fieldValue(fields, ["open_bal", "opening_balance"], "0"));
    const side = /excess|credit|payback/i.test(fieldValue(fields, ["amount_type", "opening_type", "amount_des"], module.id === "vendors" ? "Credit" : "Due"));
    if (opening.gt(0) && ["customers", "vendors", "business-parties"].includes(module.id)) {
      const type = module.id === "customers" ? "customer" : module.id === "vendors" ? "vendor" : /bank/i.test(fieldValue(fields, "p_type")) ? "bank" : "party";
      result.push(post(type, "__SELF__", side ? 0 : opening, side ? opening : 0));
    }
    return result;
  }
  if (base === "meter-sales") {
    result.push(post("cash", "cash", amount), post("revenue", "fuel", 0, amount));
    if (product) result.push(post("product", product, 0, 0, row.quantity.neg()));
    const tank = fieldValue(fields, ["tank_no", "tank"]);
    if (tank) result.push(post("tank", tank, 0, 0, row.quantity.neg()));
    if (employee) result.push(post("employee", employee, amount));
  } else if (base === "credit-sales") {
    if (!customer) throw new Error("Choose the credit customer.");
    const discount = money(fieldValue(fields, ["discount", "credit_discnt"], "0"));
    const total = amount.add(discount);
    const effect = /yes/i.test(fieldValue(fields, ["effectasst", "effect_asset"]));
    const party = fieldValue(fields, ["partytype", "crd_id"]).split("|")[0];
    result.push(post(effect && party ? "party" : "customer", effect && party ? party : customer, amount), post("cash", "cash", 0, total));
    if (discount.gt(0)) result.push(post("expense", "credit-discount", discount));
    if (employee) result.push(post("employee", employee, 0, total));
  } else if (base === "lubricant-sales") {
    const credit = /credit/i.test(fieldValue(fields, ["sale_type1", "sale_type", "pro_sale_type2", "sale_mode"]));
    result.push(post(credit && customer ? "customer" : "cash", credit && customer ? customer : "cash", amount), post("revenue", "lubricants", 0, amount));
    if (product) result.push(post("product", `lub:${product}`, 0, 0, row.quantity.neg()));
    if (!credit && employee) result.push(post("employee", employee, amount));
  } else if (base === "recoveries") {
    if (!customer) throw new Error("Choose the customer for this recovery.");
    const discount = money(fieldValue(fields, "discount", "0"));
    result.push(post(account.type, account.id, amount), post("customer", customer, 0, amount.add(discount)));
    if (discount.gt(0)) result.push(post("expense", "recovery-discount", discount));
    if (account.type === "cash" && employee) result.push(post("employee", employee, amount));
  } else if (base === "employee-recoveries") {
    // Meter receipts are already in station cash. Collection clears the DSM's
    // responsibility for that cash rather than recording the same receipt twice.
    result.push(post("employee", employee || "unassigned", 0, amount));
  } else if (base === "swipes") {
    const machine = fieldValue(fields, ["swipe_name", "swipe_bank", "swp_name", "swipesale_bank", "swipe_machine"], "bank");
    result.push(post("swipe", machine, amount), post("cash", "cash", 0, amount));
    if (employee) result.push(post("employee", employee, 0, amount));
  } else if (base === "expenses") {
    const expenseType = fieldValue(fields, ["exp_type", "expense_type", "exp_name"], "expense");
    const incoming = /inflow|income|received/i.test(fieldValue(fields, "flow", "Outflow"));
    result.push(post(incoming ? "revenue" : "expense", expenseType, incoming ? 0 : amount, incoming ? amount : 0),
      post(account.type, account.id, incoming ? amount : 0, incoming ? 0 : amount));
    if (employee && account.type === "cash") result.push(post("employee", employee, incoming ? amount : 0, incoming ? 0 : amount));
    const paidEmployee = fieldValue(fields, "pay_emply");
    if (paidEmployee && /loan|advance/i.test(fieldValue(fields, ["expense_name", "exp_name", "emppay_type"]))) result.push(post("employee-advance", paidEmployee, incoming ? 0 : amount, incoming ? amount : 0));
  } else if (["fuel-purchases", "lubricant-purchases", "other-purchases", "gift-purchases", "lfr-invoices"].includes(base)) {
    if (vendor) result.push(post("vendor", vendor, 0, amount));
    else result.push(post(account.type, account.id, 0, amount));
    result.push(post("purchase", base, amount));
    const items = Array.isArray(fields.items) ? fields.items.map(jsonFields) : [fields];
    for (const item of items) {
      const itemProduct = fieldValue(item, PRODUCT_KEYS);
      if (itemProduct && ["fuel-purchases", "lubricant-purchases", "gift-purchases"].includes(base)) result.push(post("product", base === "lubricant-purchases" ? `lub:${itemProduct}` : base === "gift-purchases" ? `gift:${itemProduct}` : itemProduct, 0, 0, quantity(fieldValue(item, QUANTITY_KEYS, row.quantity.toString()))));
      const tank = fieldValue(item, ["tank_no", "tank"]);
      if (tank && base === "fuel-purchases") result.push(post("tank", tank, 0, 0, quantity(fieldValue(item, QUANTITY_KEYS, row.quantity.toString()))));
    }
    const payment = money(fieldValue(fields, ["payment_amnt", "payment_amount"], "0"));
    if (payment.gt(0) && vendor) result.push(post("vendor", vendor, payment), post(fieldValue(fields, "payment_bank") ? "bank" : "cash", fieldValue(fields, "payment_bank", "cash"), 0, payment));
  } else if (module.id === "opening-stock") {
    // A dated stock snapshot becomes the next day's opening. Query logic applies
    // receipts and sales after that snapshot, so snapshots are never accumulated.
    return [];
  } else if (["handling-loss", "lubricant-loss"].includes(base)) {
    result.push(post("product", base === "lubricant-loss" ? `lub:${product}` : product, 0, 0, row.quantity.neg()), post("expense", "handling-loss", amount));
  } else if (module.id === "business-transactions") {
    const from = fieldValue(fields, ["partytype", "from_party"]).split("|");
    const to = fieldValue(fields, ["Topartytype", "to_party"]).split("|");
    const type = (parts: string[]) => /bank/i.test(parts[1] || "") ? "bank" : /cash/i.test(parts[0]) ? "cash" : "party";
    if (!from[0] || !to[0] || from[0] === to[0]) throw new Error("Choose two different parties for the transfer.");
    result.push(post(type(from), from[0] === "Cash" ? "cash" : from[0], 0, amount), post(type(to), to[0] === "Cash" ? "cash" : to[0], amount));
  } else if (module.id === "vendor-transactions") {
    const incoming = /receive|inflow|inward|credit|received/i.test(fieldValue(fields, ["trans_type", "trxn_type", "type", "flow", "payment_type"], "Paid"));
    result.push(post(account.type, account.id, incoming ? amount : 0, incoming ? 0 : amount), post("vendor", vendor || "unassigned", incoming ? 0 : amount, incoming ? amount : 0));
  } else if (module.id === "swipe-settlements") {
    const charges = money(fieldValue(fields, "charges", "0"));
    const type = fieldValue(fields, "attach_type") === "Vendor" ? "vendor" : "bank";
    result.push(post("swipe", fieldValue(fields, "swipe_bank"), 0, amount.add(charges)),
      post(type, fieldValue(fields, "attach_id"), amount), post("expense", "swipe-charges", charges));
  } else if (base === "guest-sales") {
    if (account.type !== "cash") {
      result.push(post(account.type, account.id, amount), post("cash", "cash", 0, amount));
      if (employee) result.push(post("employee", employee, 0, amount));
    }
    const points = quantity(fieldValue(fields, "points", "0"));
    if (points.gt(0)) result.push(post("loyalty", fieldValue(fields, ["guest_id", "customer_id"]), 0, 0, points));
  } else if (base === "gift-sales") {
    const points = quantity(fieldValue(fields, ["points", "gift_points"], "0"));
    result.push(post("loyalty", fieldValue(fields, ["guest_cust", "customer_id"]), 0, 0, points.neg()),
      post("product", `gift:${fieldValue(fields, ["gifts", "product"])}`, 0, 0, -1));
  } else if (module.id === "interest") {
    const interest = money(fieldValue(fields, ["interest_amount", "int_amount", "amount"], amount.toString()));
    result.push(post("customer", customer || fieldValue(fields, "crd_name", "unassigned"), interest), post("revenue", "interest", 0, interest));
  }
  return result;
}

export function safeFields(fields: PetrosoftFields): Prisma.InputJsonObject {
  const output: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || /password|passwd|^pwd$|^pass$|^u_pass$|Pwd$|token|api_key|auth_secret|sms_url|sms_username|api_link/i.test(key)) continue;
    output[key] = Array.isArray(value) ? value.map(item => item && typeof item === "object" ? safeFields(jsonFields(item)) : item) as Prisma.InputJsonValue
      : value && typeof value === "object" && !(value instanceof Decimal) && !(value instanceof Date) ? safeFields(jsonFields(value))
        : JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
  return output;
}

export function validateSchema(module: ModuleSchema, index: number | undefined, fields: PetrosoftFields, editing = false) {
  const schema = module.forms.find(form => form.index === index);
  if (!schema || schema.operation !== "save") return;
  for (const field of schema.fields) {
    if (!field.required || ["hidden", "file", "checkbox", "radio"].includes(field.type)) continue;
    if (editing && field.type === "password") continue;
    if (/total|tot_|cost|amount|balance|cls_rate|var_amt|inclrate|purvat|purtcs|dealercomm|othertxs|batta|disc|desc|open_bal|gst|vat|tcs|lfr|hsn|min_quantity/i.test(field.name)) continue;
    const value = fields[field.name] ?? fields[field.name.replace(/\[\]$/, "")];
    if (value === undefined || value === "" || (Array.isArray(value) && value.every(item => item === ""))) {
      throw new Error(`${field.label.replace(/\s*\*\s*$/, "") || field.name} is required.`);
    }
  }
}

export function rowFromImport(_module: ModuleSchema, input: PetrosoftFields): PetrosoftFields {
  const fields = { ...input };
  const cells = Array.isArray(fields.__cells) ? fields.__cells.map(String) : [];
  const headers = Array.isArray(fields.__headers) ? fields.__headers.map(String) : [];
  for (let index = 0; index < headers.length; index++) {
    const header = headers[index].toLowerCase().replace(/[\s_\u00a0]/g, ""), value = cells[index] || "";
    if (/^(date|saledate|invoicedate|purchasedate|transactiondate|joindate)$/.test(header)) fields._date = value.split(" ")[0];
    if (/^(price|rate|productrate|salerate)$/.test(header)) fields.price = value.replace(/[^\d.,-]/g, "");
    if (/^(quantity|qty|netsale|sold|netqty)$/.test(header)) fields.quantity = value.replace(/[^\d.,-]/g, "");
    if (/^(cost.*|totalamount.*|saleamount.*|invoiceamount.*|paidamt.*|paidamount.*|amount.*)$/.test(header) && !/discount/.test(header)) fields.amount = value.replace(/[^\d.,-]/g, "");
    if (/organization|org\/cust|customername/.test(header)) fields.__customerName = value;
    if (/^(product|productname)$/.test(header)) fields.__productName = value;
    if (/^(vendor|vendorname)$/.test(header)) fields.__vendorName = value;
    if (/^(employee|empname)$/.test(header)) fields.__employeeName = value;
  }
  for (const key of ["salary", "credit_limit", "open_bal", "min_quantity", "vat", "tcs", "lfr", "gst", "price", "quantity", "amount"]) {
    const raw = fields[key];
    if (typeof raw === "string" && raw !== "" && !/^[-\d.,]+$/.test(raw)) {
      const matches = raw.match(/-?\d[\d,]*(?:\.\d+)?/g);
      fields[key] = matches?.[0]?.replace(/,/g, "") || "0";
    }
  }
  return fields;
}

export function fieldsObject(value: unknown) { return jsonFields(value); }
export function numericTotal(rows: { amount: Prisma.Decimal }[]) {
  return rows.reduce((sum, row) => sum.add(row.amount), new Decimal(0));
}
export { fieldNumber, fieldValue };
