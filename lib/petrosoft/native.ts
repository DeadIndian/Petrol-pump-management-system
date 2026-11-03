import { Prisma } from "@prisma/client";
import { dateValue, fieldValue, jsonFields, moduleById, today, type PetrosoftFields } from "./catalog";
import { ledgerFor, money, quantity, safeFields, type LedgerPosting, type NormalizedRow } from "./rules";

export interface NativeBackup { format: string; sourceSha256: string; insertRows: number; tables: Record<string, PetrosoftFields[]> }
export interface NativeEntry { module: string; externalId: string; number: number; row: NormalizedRow; posts: LedgerPosting[] }
const raw = (record: PetrosoftFields, key: string, fallback = "") => fieldValue(record, key, fallback);
const map = (record: PetrosoftFields, aliases: Record<string, string>) => {
  const fields: PetrosoftFields = { ...record, _native: true };
  for (const [target, source] of Object.entries(aliases)) fields[target] = record[source] ?? "";
  return fields;
};
const inactive = (record: PetrosoftFields) => raw(record, ["InActive", "Inactive", "inActive", "inactive"].find(key => record[key] !== undefined) || "InActive") === "1";
const safeDate = (record: PetrosoftFields, keys: string[]) => {
  for (const key of keys) { try { if (record[key] && !String(record[key]).startsWith("0000")) return dateValue(record[key]); } catch { /* Invalid legacy dates have no financial effect. */ } }
  return today();
};
const decimalField = (record: PetrosoftFields, key?: string) => {
  try { return key ? quantity(record[key] || 0) : quantity(0); } catch { return quantity(0); }
};

export function nativeSettings(backup: NativeBackup, htmlSettings: PetrosoftFields = {}) {
  const company = backup.tables.company_info?.[0] || {};
  const settings = { ...htmlSettings, ...company, ...backup.tables.app_settings?.[0],
    contact: company.company_contactNo, contact2: company.contact_no2, email: company.company_email,
    tin: company.TIN, vendor: company.bunk_vendor, shiftstuts: company.shiftstatus, num_fmt: company.currency_format,
    credit_limit: company.limit_block_access, app_balc_view: company.app_dsm_balance_view,
    app_manual_calc: company.app_manual_calculations, mobileapp_pushnoti: company.mobileapp_pushnotification,
    pos_settlement: company.swipe_pos_settlement, bowser_effect: company.bowereffctOn,
    godown_Sale: company.godowneffctOn, nonbusi_expsetle: company.offduty_empexpens_settle,
    expiry_items: company.expired_items_auto_sms, sale_entry: company.sale_entry_order,
  };
  for (const key of ["print_settings", "tally_settings"]) {
    try { Object.assign(settings, JSON.parse(String(company[key] || "{}"))); } catch { /* Keep source settings intact. */ }
  }
  const selected = Array.isArray(htmlSettings["page_id[]"]) ? htmlSettings["page_id[]"].map(String)
    : (backup.tables.settings || []).filter(row => row.status === "yes").map(row => String(row.page_id));
  return safeFields({ ...settings, feature_ids: [...new Set(selected)], purchase_policy: {
    lfr_tot: selected.includes("1") ? "yes" : "no", delar_comm: selected.includes("2") ? "yes" : "no",
    lfr_incl: selected.includes("3") ? "yes" : "no", del_incl: selected.includes("24") ? "yes" : "no",
    lfr_other: selected.includes("35") ? "yes" : "no",
  } });
}

export function nativeEntries(backup: NativeBackup): NativeEntry[] {
  const tables = backup.tables;
  const entries: NativeEntry[] = [];
  const sequences = new Map<string, number>();
  function add(moduleId: string, table: string, record: PetrosoftFields, idKey: string, aliases: Record<string, string>, options: {
    date?: string[]; name?: string; amount?: string; total?: unknown; count?: string; rate?: string; fields?: PetrosoftFields; posts?: LedgerPosting[]; noPosts?: boolean;
  } = {}) {
    const moduleSchema = moduleById.get(moduleId);
    if (!moduleSchema) throw new Error("Unknown import module " + moduleId);
    const fields: PetrosoftFields = { ...map(record, aliases), ...options.fields, _native_table: table, _native_id: raw(record, idKey) };
    const date = safeDate(record, options.date || ["date", "createdDate", "created_date"]);
    fields._date = date.toISOString().slice(0, 10);
    const row: NormalizedRow = {
      name: options.name ? raw(fields, options.name) : raw(fields, "name", moduleSchema.title), date,
      amount: money(options.total ?? decimalField(record, options.amount)), quantity: options.count ? decimalField(record, options.count) : quantity(fieldValue(fields, "quantity", "0")), rate: decimalField(record, options.rate),
      status: inactive(record) ? moduleSchema.kind === "master" ? "inactive" : "void" : "active", fields,
    };
    let posts: LedgerPosting[] = [];
    if (!options.noPosts) {
      try { posts = options.posts || ledgerFor(moduleSchema, row); } catch { /* A zero/incomplete historical entry is retained, not invented. */ }
    }
    // The exported vendor ledger is authoritative. Historical parent records can
    // disagree with their vendor contra entries, so retain those original postings.
    if (moduleId !== 'vendor-transactions') posts = posts.filter(post => post.entityType !== 'vendor');
    const externalId = raw(record, idKey);
    const sourceNumber = /^\d+$/.test(externalId) ? Number(externalId) : (sequences.get(moduleId) || 0) + 1;
    sequences.set(moduleId, Math.max(sequences.get(moduleId) || 0, sourceNumber));
    entries.push({ module: moduleId, externalId, number: sourceNumber, row, posts });
  }
  const each = (table: string, callback: (fields: PetrosoftFields) => void) => (tables[table] || []).forEach(callback);
  const partyById = new Map((tables.k_businesscreditors || []).map(row => [raw(row, "crd_id"), row]));
  const bankType = (id: string) => raw(partyById.get(id) || {}, "partyType") === "Bank" ? "bank" : "party";
  const borrowById = new Map((tables.k_borrowfunds || []).map(row => [raw(row, "trans_id"), row]));
  const vendorTransById = new Map((tables.k_vendortrans || []).map(row => [raw(row, "trans_id"), row]));
  each("k_lqproducts", r => add("fuel-products", "k_lqproducts", r, "prod_id", { name: "prod_name", liqpro_name: "prod_name", short_name: "Short_name", min_quantity: "min_qty" }, { name: "liqpro_name" }));
  each("k_product", r => add("lubricants", "k_product", r, "p_id", { pro_name: "product_name", name: "product_name" }, { name: "pro_name", rate: "sale_rate" }));
  each("k_cust", r => add("customers", "k_cust", r, "cust_id", { name: "org_name", join_dt: "cust_date", cust_gstno: "gst_no", org_address: "org_addr", org_address2: "another_address", phone_no: "phn", alt_phone_no: "alt_phn", cust_category: "category", eml: "email", amount_type: "opeing_type", open_dt: "op_date" }, { date: ["op_date", "cust_date"], name: "org_name" }));
  each("k_emp", r => add("employees", "k_emp", r, "emp_id", { name: "emp_name", join_dt: "join_date", emp_ph_no: "phone", aadhaar_no: "adhar_no", emp_addrs: "address", emp_desc: "description", emp_limit: "shortage_limit", pf: "pf", esi: "esi", it: "it" }, { date: ["join_date"], name: "emp_name", rate: "salary", noPosts: true }));
  each("k_expenstype", r => add("expense-types", "k_expenstype", r, "exptype_id", { name: "exp_name", effectemp: "effect_employee" }, { name: "exp_name" }));
  each("k_businesscreditors", r => {
    const open = borrowById.get(raw(r, "openmodule_id"));
    const fields = { open_bal: open?.trans_amnt || "0", opening_type: r.openmodule_name || "Debit", open_dt: open?.trans_dt || r.date };
    add("business-parties", "k_businesscreditors", r, "crd_id", { name: "crd_name", p_type: "partyType", join_dt: "date", desc: "crd_desc" }, { name: "crd_name", fields });
  });
  each("k_vendors", r => {
    const opening = vendorTransById.get(raw(r, "openmodule_id"));
    add("vendors", "k_vendors", r, "vend_id", { name: "vend_compname", ven_comp: "vend_compname", ven_phno: "vend_compphn", gst_no: "gstin", ven_eml: "vend_compemail", ven_desc: "vend_desc", vend_details: "vend_compaddress" }, { name: "ven_comp", fields: { open_bal: opening?.trans_amnt || "0", amount_des: r.openmodule_name || "Credit", open_dt: opening?.trans_dt || r.createdDate }, noPosts: true });
  });
  each("k_swipebanks", r => add("swipe-machines", "k_swipebanks", r, "s_id", { name: "bank_name", swipe_name: "bank_name" }, { name: "swipe_name", fields: { attach_bank: r.attach_type === "Bank" ? r.attach_id : "", attach_vendor: r.attach_type === "Vendor" ? r.attach_id : "" } }));
  each("k_tank", r => add("tanks", "k_tank", r, "tank_id", { name: "tank_name", pro_name: "product" }, { name: "tank_name" }));
  each("k_nozzel", r => add("nozzles", "k_nozzel", r, "nozel_id", { name: "noz_name", nozzle_id: "nozel_id", nozzle_name: "noz_name" }, { name: "noz_name", noPosts: true }));
  each("k_pump_nozzel", r => {
    const pump = (tables.k_pumps || []).find(p => p.pump === r.pump_no);
    add("pump-settings", "k_pump_nozzel", r, "pump_id", { pump_name: "pump_no", noz: "nozzel_id", product: "prod_id" }, { name: "pump_name", fields: { pump_display_name: pump?.pump_name || "", pump_order: r.pump_order || "0" } });
  });
  each("e_shift", r => add("duty-shifts", "e_shift", r, "id", { name: "shift_type", shift_name: "shift_type" }, { name: "shift_type" }));
  each("k_shifts", r => add("business-shifts", "k_shifts", r, "shift_id", { name: "shift", pump_name: "shift", shift_name: "shift" }, { name: "shift" }));
  each("g_cust", r => add("guests", "g_cust", r, "g_id", { name: "g_cust_name", g_name: "g_cust_name", g_number: "g_mobileno", g_date: "g_date" }, { name: "g_name", date: ["g_date"] }));
  each("d_denominations", r => add("denominations", "d_denominations", r, "id", { name: "d_value", d_val: "d_value", denomination: "d_value", denom_value: "d_value" }, { name: "d_val" }));
  each("user_roles", r => add("roles", "user_roles", r, "role_id", { name: "role_name" }, { name: "role_name", fields: { page_ids: (tables.user_roles_pages || []).filter(p => p.role_id === r.role_id).map(p => p.page_id) }, noPosts: true }));
  each("users", r => add("users", "users", r, "user_id", { name: "username", user_name: "username", full_name: "firstname", role: "user_role", employee: "user_empid", date: "insert_date" }, { name: "user_name", noPosts: true }));
  each("loyalty_tiers", r => add("loyalty-tiers", "loyalty_tiers", r, "id", { name: "tier_name", points_rate: "points_needed" }, { name: "tier_name" }));
  each("loyalty_points_config", r => add("loyalty-points", "loyalty_points_config", r, "id", { name: "tier_name", product: "prod_id", points_rate: "points_per_qty" }, { name: "tier_name" }));
  each("gifts", r => add("gifts", "gifts", r, "id", { name: "name", emp_name: "name", emp_no: "points", emp_desc: "description", join_dt: "date" }, { name: "name" }));
  each("dialy_sale_rate", r => add("daily-rates", "dialy_sale_rate", r, "rate_id", {}, { date: ["rate_date"], rate: "new_rate", fields: { insert_date: r.rate_date, var_amt: r.v_amt } }));
  each("k_lqsale_nozpump", r => add("meter-sales", "k_lqsale_nozpump", r, "pnoz_id", { product: "pnoz_prodid", tank_no: "tank_no", pump_id: "pumpnozset_id", pump: "pump_no", nozzle_id: "pnoz_nozid", nozzle: "pnoz_nozid", open_read: "pnoz_openrd", close_read: "pnoz_closerd", test_qty: "pnoz_test", price: "pnoz_prodprice", quantity: "pnoz_saleqnt", cost: "pnoz_saleamt", employee: "pnoz_empid", employee_id: "pnoz_empid" }, { date: ["sale_pdate"], amount: "pnoz_saleamt", count: "pnoz_saleqnt", rate: "pnoz_prodprice" }));
  each("k_custcredits", r => add(raw(r, "bowser_trxn") === "Yes" ? "bowser-credit-sales" : "credit-sales", "k_custcredits", r, "creditdet_id", { organiz: "custorg_id", customer_id: "custorg_id", vehi_no: "vehicle_no", product: "prod_name", qnty: "quant_no", price: "credit_price", cost: "credit_cost", credit_discnt: "credit_discount", credit_billno: "bill_no", batta_amt: "batta", credsale_emp: "emp_id" }, { date: ["credit_date"], total: money(decimalField(r, "credit_cost").add(decimalField(r, "batta"))), count: "quant_no", rate: "credit_price", fields: { credsale_emp: r.emp_id, employee: r.emp_id, discount: r.credit_discount, misc_charges: r.batta, total_amount: money(decimalField(r, "credit_cost").add(decimalField(r, "batta"))).toString(), desc: r.description } }));
  each("k_recovery", r => add(raw(r, "bowser_trxn") === "Yes" ? "bowser-recoveries" : "recoveries", "k_recovery", r, "recovery_id", { rec_organiz: "organization", customer_id: "organization", rec_emp: "rec_empid", rec_desc: "des", re_type: "re_type", banktype_field: "recbank_type", discount: "disc_amt", rec_disc_amt: "disc_amt", balance: "bala_amt", employee: "rec_empid" }, { date: ["date"], amount: "paid_amt", fields: { vendor_id: r.vendor_id, bank_id: r.crd_id, swipe_bank: r.recbank_type } }));
  each("k_swipecash", r => add(raw(r, "bowser_trxn") === "Yes" ? "bowser-swipes" : "swipes", "k_swipecash", r, "swp_id", { swipe_bank: "swp_bank", swipe_amt: "swp_amt", swipesale_emp: "swp_empid", swp_billno: "swp_batchno", swipe_des: "swp_des", employee: "swp_empid" }, { date: ["swp_date"], amount: "swp_amt" }));
  each("k_swipe_settlement", r => {
    const amount = decimalField(r, "stl_crdt_amt"), charges = decimalField(r, "charges");
    const type = raw(r, "stl_vend_id", "0") !== "0" ? "vendor" : "bank";
    const id = raw(r, type === "vendor" ? "stl_vend_id" : "stl_crd_id");
    add("swipe-settlements", "k_swipe_settlement", r, "stl_id", { swipe_bank: "stl_swp_machine", date: "stl_date", amount: "stl_crdt_amt", description: "stl_desc" }, { date: ["stl_date"], amount: "stl_crdt_amt", posts: [
      { entityType: "swipe", entityId: raw(r, "stl_swp_machine"), credit: amount.add(charges) },
      { entityType: type, entityId: id, debit: amount }, { entityType: "expense", entityId: "swipe-charges", debit: charges },
    ] });
  });
  each("k_expenses_list", r => add(raw(r, "bowser_trxn") === "Yes" ? "bowser-expenses" : "expenses", "k_expenses_list", r, "expses_id", { employees: "expses_empid", employee: "expses_empid", exp_type: "expses_type", expense_name: "expses_name", flow: "category", exp_amt: "expses_amt", exp_paytype: "exp_paytype", expbanktype_field: "exp_paybank", descript: "expses_des", partyname_field: "party_name", expeffectasst: "effect_asset", pay_emply: "exppay_empid" }, { date: ["expses_dt"], amount: "expses_amt", fields: { vendor_id: r.exp_paytype === 'Vendor' ? r.exp_paybank : r.attach_id, expvendtype_field: r.exp_paybank, bank_id: r.crd_id } }));
  each("k_empcashrecovery", r => add("employee-recoveries", "k_empcashrecovery", r, "empcashrec_id", { recamnt: "collected", employee: "emp_id", emprec_desc: "descript", emp_balance: "balance", colemp_id: "collected_emp" }, { date: ["cashrecdate"], amount: "collected" }));
  each("k_purchase", r => {
    const items = (tables.k_pur_product || []).filter(item => item.pur_id === r.pur_id).map(item => ({ ...map(item, { product: "p_product_no", prod_code: "p_product_no", quantity: "product_qty", pro_qty: "product_qty", price: "pur_prorate", rate: "pur_prorate", purrate: "pur_prorate", amount: "pur_itemtot", cost: "pur_itemtot", purvat: "pur_vat", lfr: "pur_lfr", purtcs: "pur_tcs", othertxs: "pur_othertxs", dealercomm: "dealer_comm" }) }));
    add(raw(r, "is_lfr") === "1" ? "lfr-invoices" : raw(r, "gst_prod") === "1" ? "other-purchases" : "fuel-purchases", "k_purchase", r, "pur_id", { invo_no: "invoice", liq_vendor: "vendor_id", paymode: "purmode", descript: "description", total_amt: "inv_total", roundingoff: "roundoff" }, { date: ["pur_date"], amount: "inv_total", fields: { items, quantity: items.reduce((sum, item) => sum.add(String(item.quantity || 0)), quantity(0)).toString() } });
  });
  each("k_product_details", r => {
    if (raw(r, "k_prduct_type") !== "P") return;
    const items = (tables.k_npur_product || []).filter(item => item.purc_amt_id === r.k_prdct_id).map(item => map(item, { product: "prod_id", pur_proname1: "prod_id", quantity: "pro_qty", rate: "pro_rate", amount: "total_amt", pur_sgst: "sgst", pur_cgst: "cgst", pur_igst: "igst" }));
    add("lubricant-purchases", "k_product_details", r, "k_prdct_id", { invo_no: "invoiceno", lub_vendor: "vendor_id", descript: "descript", paymode: "purmode", invoice_tot: "invoice_tot", cashdisc: "cashdisocunt" }, { date: ["k_prduct_date"], total: decimalField(r, raw(r, 'invoice_tot') ? 'invoice_tot' : 'k_tot_amt'), fields: { items, quantity: items.reduce((sum, item) => sum.add(String(item.quantity || 0)), quantity(0)).toString() } });
  });
  each("k_sale_product", r => add(raw(r, "bowser_trxn") === "Yes" ? "bowser-lubricant-sales" : "lubricant-sales", "k_sale_product", r, "s_prd_id", { product: "s_product_name", pro_name2: "s_product_name", sale_type1: "sale_type", customer_id: "org_name", quantity: "s_pro_qty", pro_qty1: "s_pro_qty", rate: "s_pro_rate", price: "s_pro_rate", pro_rate1: "s_pro_rate", pro_amt1: "s_pro_amt", discount: "s_pro_disc", disc_amt: "s_pro_disc", employee: "s_emp_id", prodsale_emp: "s_emp_id", billno: "s_pro_billno", ind_no: "s_pro_indentno", lubvehi_no: "s_vehicle_no" }, { date: ["s_pro_date"], amount: "s_pro_amt", count: "s_pro_qty", rate: "s_pro_rate" }));
  each("k_product_details", r => {
    if (raw(r, "k_prduct_type") !== "S" || (tables.k_sale_product || []).some(item => item.sale_amt_id === r.k_prdct_id)) return;
    add("lubricant-sales", "k_product_details", r, "k_prdct_id", { sale_type1: "sale_type", customer_id: "org_name", discount: "discount" }, { date: ["k_prduct_date"], amount: "k_tot_amt", fields: { _orphan_header: true }, noPosts: true });
    entries[entries.length - 1].externalId = "header-" + raw(r, "k_prdct_id");
    entries[entries.length - 1].number = (sequences.get("lubricant-sales") || 0) + 1;
    sequences.set("lubricant-sales", entries[entries.length - 1].number);
  });
  each("k_vendortrans", r => {
    const direct = raw(r, "invoice_of") === 'Vendor';
    const partner = (tables.k_borrowfunds || []).find(item => item.trans_frmModule === "VENDOR" && item.trans_frmModule_Id === r.trans_id);
    const debit = raw(r, "trans_type") === "Debit", amount = decimalField(r, "trans_amnt");
    const posts: LedgerPosting[] = [{ entityType: "vendor", entityId: raw(r, "vendor_id"), debit: debit ? amount : 0, credit: debit ? 0 : amount }];
    if (direct) posts.push({ entityType: partner ? bankType(raw(partner, "crd_id")) : "cash", entityId: partner ? raw(partner, "crd_id") : "cash", debit: debit ? 0 : amount, credit: debit ? amount : 0 });
    add("vendor-transactions", "k_vendortrans", r, "trans_id", { vendor: "vendor_id", Vendor: "vendor_id", trans_amnt: "trans_amnt", trans_desc: "trans_desc" }, { date: ["trans_dt"], amount: "trans_amnt", fields: { bank: partner?.crd_id || "Cash", payment_mode: partner ? "Bank" : "Cash", bank_id: partner?.crd_id || "", derived: !direct && raw(r, 'invoice_of') !== 'OPENING' }, posts });
  });
  each("k_borrowfunds", r => {
    const amount = decimalField(r, "trans_amnt"), debitId = raw(r, "debit_id", "0"), creditId = raw(r, "credit_id", "0");
    const direct = raw(r, "trans_frmModule") === "self";
    const posts: LedgerPosting[] = [];
    if (direct) {
      if (debitId !== "0" || creditId !== "0") {
        if (debitId !== "0") posts.push({ entityType: bankType(debitId), entityId: debitId, debit: amount });
        if (creditId !== "0") posts.push({ entityType: bankType(creditId), entityId: creditId, credit: amount });
      } else {
        const type = raw(r, "trans_type") === "Debit";
        posts.push({ entityType: bankType(raw(r, "crd_id")), entityId: raw(r, "crd_id"), debit: type ? amount : 0, credit: type ? 0 : amount });
      }
    }
    add("business-transactions", "k_borrowfunds", r, "trans_id", { partytype: "debit_id", Topartytype: "credit_id", trans_amnt: "trans_amnt", trans_desc: "trans_desc" }, { date: ["trans_dt"], amount: "trans_amnt", posts, noPosts: !direct });
  });
  each("master_entry", r => {
    const csv = (key: string) => raw(r, key).split(",").filter(Boolean);
    const posts: LedgerPosting[] = [];
    const earliest = (tables.master_entry || []).reduce((first, item) => String(item.edate) < String(first.edate) ? item : first, r);
    if (earliest.eid === r.eid) posts.push({ entityType: "cash", entityId: "cash", debit: decimalField(r, "open_bal"), description: "Opening cash balance" });
    for (const [key, incoming] of [["handedFunds", false], ["receivedFunds", true]] as const) {
      for (const id of csv(key)) {
        const trans = borrowById.get(id);
        if (!trans) continue;
        const amount = decimalField(trans, "trans_amnt"), party = raw(trans, "crd_id");
        posts.push({ entityType: "cash", entityId: "cash", debit: incoming ? amount : 0, credit: incoming ? 0 : amount },
          { entityType: bankType(party), entityId: party, debit: incoming ? 0 : amount, credit: incoming ? amount : 0 });
      }
    }
    add("settlements", "master_entry", r, "eid", { insert_date: "edate", finialbankamt: "final_stle", opencash: "open_bal", closecash: "close_bal", hand_des: "description", pettycash: "petty_cash" }, { date: ["edate"], amount: "close_bal", posts });
  });
  each("k_stock", r => add("opening-stock", "k_stock", r, "stock_id", { product: "prod_id", tank_no: "stock_tank", insert_date: "stock_date" }, { date: ["stock_date"], count: "open_stock", rate: "prod_rate", noPosts: true }));
  each('so_stock_dtl', r => add('sales-officer', 'so_stock_dtl', r, 'id', { product: 'prod_id', beforedip: 'dip_value', beforesotck: 'prevs_stock', totsale: 'sale' }, { date: ['date'], count: 'dip_stock', noPosts: true }));
  const extras: [string, string, string, Record<string, string>, string?, string?, string?][] = [
    ["vehicles", "k_custvehicle", "vehicle_id", { name: "vehi_no", vehicle_no: "vehi_no", customer_id: "cust_id", vehicle_place: "vehi_place", vehicle_type: "vehi_type" }],
    ["customer-discounts", "k_cust_prod_discount", "cpd_id", { customer_id: "cust_id", product: "prod_id", name: "prod_id" }],
    ["employee-benefits", "k_emp_earn", "id", { employee: "emp_id", name: "earn_type", amount: "amt" }, "created_on", "amt"],
    ["employee-payments", "k_emp_pay", "pay_id", { employee: "emp_id", amount: "pay_amount", description: "pay_note" }, "pay_date", "pay_amount"],
    ["attendance", "k_empattend", "attend_id", { date: "date_attend", insert_date: "date_attend" }, "date_attend"],
    ["attendance-details", "k_empattendens_list", "attendList_id", { employee: "attend_empid", attend_type: "attend_type", description: "description" }, "attend_Date"],
    ["expiry-categories", "k_expiryItemcat", "cat_id", { name: "cat_name" }],
    ["expiry-items", "k_expiryItem_reg", "id", { name: "item_name" }, "date"],
    ["expiry-renewals", "k_expiryItem_renewal", "id", { name: "item_number" }, "date"],
    ["calibration", "k_calbritank", "calib_id", { name: "calib_tank", tank_no: "calib_tank", capacity: "calib_tankcap", product: "calib_pro" }],
    ["statement-records", "k_custgenbillstate", "id", { customer_id: "cust_id", name: "ref_no", amount: "bill_amt" }, "to_dt", "bill_amt"],
    ["guest-sales", "g_sales", "g_sleid", { customer_id: "g_cust_id", product: "prod_id", employee: "emp_id", price: "price", qnty: "quantity", cost: "amount" }, "g_sale_date", "amount", "quantity"],
    ["handling-loss", "k_handling", "id", { product: "product_id", price: "price", qnty: "quantity", cost: "amount", desc: "remarks" }, "Loss_date", "amount", "quantity"],
    ["lubricant-loss", "k_product_lubloss", "loss_id", { product: "lub_id", pro_qty1: "qty", pro_rate1: "rate", pro_amt1: "amt" }, "entry_date", "amt", "qty"],
    ["gifts", "gifts", "id", { name: "name", emp_name: "name", emp_no: "points" }, "date"],
    ["gift-purchases", "gift_pur", "p_id", { product: "g_id", vend: "v_id", vendor: "v_id", qty: "qty" }, "p_date", "cost", "qty"],
    ["gift-sales", "gift_sale", "s_id", { customer_id: "g_id", gifts: "gift_id", points: "g_points" }, "s_date"],
    ["feedback", "k_feedback", "feed_id", { ph_num: "ph_num", rating: "rating" }, "f_dt"],
    ["bowsers", "k_bowser", "id", { name: "b_name", vehicle: "b_vehicle", capacity: "b_capacity" }],
    ["bowser-nozzles", "k_bowser_nozzles", "id", { name: "nozzle_name", bowser: "bowser_id" }],
    ["credit-requests", "k_custreqts", "req_id", { customer_id: "cust_id", req_vehicle: "vehi_no", product: "prod_id", req_qty: "order_unit", req_desc: "descrpt" }, "requested_date"],
    ["brs", "k_brs", "id", { partytype: "bank_id", amount: "Amount", less_amnt: "Amount", description: "trans_desc", reconciled: "settle" }, "trans_dt", "Amount"],
    ["vrs", "k_vrs", "id", { partytype: "bank_id", amount: "Amount", less_amnt: "Amount", description: "trans_desc", reconciled: "settle" }, "trans_dt", "Amount"],
  ];
  for (const [module, table, key, aliases, date, amount, count] of extras) each(table, r => {
    if (table === "gifts" && entries.some(entry => entry.module === "gifts" && entry.externalId === raw(r, key))) return;
    add(module, table, r, key, aliases, { date: date ? [date] : undefined, amount, count, noPosts: !["guest-sales", "handling-loss", "lubricant-loss", "gift-purchases"].includes(module) });
  });
  return entries;
}

export function nativeId(fields: PetrosoftFields, index: number) {
  const first = Object.keys(fields)[0];
  return String(fields[first] ?? index + 1);
}

export function jsonInput(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
export { jsonFields };
