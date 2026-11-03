(function () {
  "use strict";
  const R = window.PetrosoftRuntime;
  if (!R) return;
  const { state, context, esc } = R;
  const sourceForms = new Map(Array.from(document.querySelectorAll("form[data-ps-form]")).map(form => [form.dataset.psForm, form.cloneNode(true)]));
  let rowCounter = 1;
  R.formRows = form => {
    const rows = Array.from(form.querySelectorAll("[data-ps-row]")).filter(row => !row.parentElement.closest("[data-ps-row]"));
    return rows.length ? rows : [form];
  };
  R.rowFor = field => field.closest("[data-ps-row]") || field.form;
  R.toggleFields = (row, names, visible) => {
    for (const name of names) for (const field of row.querySelectorAll(`[name="${name}"],[name="${name}[]"]`)) {
      const parent = field.closest('[class*="col-md-"],[class*="col-sm-"]') || field.parentElement;
      if (parent) parent.style.display = visible ? "" : "none";
      if (!visible && field.required) { field.dataset.psWasRequired = "1"; field.required = false; }
      if (visible && field.dataset.psWasRequired) field.required = true;
    }
  };
  R.renumber = row => {
    const number = ++rowCounter, ids = new Map();
    for (const element of row.querySelectorAll("[id]")) { const old = element.id; element.id = `${old.replace(/\d+$/, "")}_ps${number}`; ids.set(old, element.id); }
    for (const element of row.querySelectorAll("[for],[list],[data-target]")) {
      for (const attribute of ["for", "list", "data-target"]) { const value = element.getAttribute(attribute); if (value && ids.has(value.replace(/^#/, ""))) element.setAttribute(attribute, (value.startsWith("#") ? "#" : "") + ids.get(value.replace(/^#/, ""))); }
    }
    return row;
  };
  R.reindex = form => {
    const bases = JSON.parse(form.dataset.psIndexBases || "{}");
    const rows = R.formRows(form);
    for (const row of rows) for (const field of row.querySelectorAll("[name]")) {
      const match = field.name.match(/^(\w+)\[(\d+)\](\[\])?$/);
      if (match && bases[match[1]] === undefined) bases[match[1]] = Number(match[2]);
    }
    rows.forEach((row, index) => row.querySelectorAll("[name]").forEach(field => {
      const match = field.name.match(/^(\w+)\[(\d+)\](\[\])?$/);
      if (match) field.name = `${match[1]}[${index + bases[match[1]]}]${match[3] || ""}`;
    }));
    form.dataset.psIndexBases = JSON.stringify(bases);
  };
  R.cleanClone = area => {
    if (!area) return null;
    area.querySelectorAll(".ts-wrapper,.select2-container,.bootstrap-datetimepicker-widget").forEach(element => element.remove());
    for (const field of area.querySelectorAll("input,select,textarea")) {
      field.classList.remove("tomselected", "ts-hidden-accessible", "select2-hidden-accessible");
      field.removeAttribute("tabindex"); field.removeAttribute("aria-hidden"); field.removeAttribute("data-ps-date");
      if (field.tagName === "SELECT") { field.style.display = ""; field.tomselect = undefined; }
      if (field.type === "file") field.value = "";
    }
    return area;
  };
  R.addRow = control => {
    const form = control.closest("form"), current = control.closest("[data-ps-child-row],[data-ps-row]") || R.formRows(form)[0];
    if (!form || current === form) return;
    const clone = R.cleanClone(R.renumber(current.cloneNode(true)));
    for (const field of clone.querySelectorAll("input,select,textarea")) {
      if (field.type === "checkbox" || field.type === "radio") field.checked = false;
      else if (field.type !== "hidden" || !/gst|vat|source|prefix|bowser/.test(field.name)) field.value = field.tagName === "SELECT" ? "" : /cost|amount|_amt|qty|qnty|rate|disc|lfr|vat|tcs|cess|read/.test(field.name) ? "0" : "";
    }
    current.after(clone); R.reindex(form); R.fillRelations(clone); R.initWidgets(clone); R.calculateForm(form);
    clone.querySelector("input:not([type=hidden]),select")?.focus();
  };
  function related(row, relation) { return row.querySelector(`select[data-ps-relation="${relation}"]`); }
  R.relationChanged = field => {
    const row = R.rowFor(field); if (!row) return;
    const relation = field.dataset.psRelation, record = R.master(relation, field.value), f = record?.fields || {}, module = R.base(field.form.dataset.psModule || context.module.id);
    if (relation === "fuel-products" || relation === "lubricants" || relation === "gifts") {
      let rate = relation === "fuel-products" ? state.rates?.[field.value]?.closing || R.value(f, "sale_rate", "0") : relation === "gifts" ? "0" : R.value(f, "sale_rate", "0");
      if (/purchases/.test(module)) rate = R.fieldValue(row, module === "fuel-purchases" ? "purrate" : "pur_prorate", "0");
      for (const name of ["price", "pro_rate1", "sale_amt", "emp_rate"]) if (R.field(row, name)) R.set(row, name, rate);
      for (const [name, key] of [["gst", "gst"], ["gstrate", "gst"], ["vat_rate", "vat"], ["lfr_rate", "lfr"], ["tcsfieldid", "tcs"], ["gst_no", "gst_no"]]) R.set(row, name, R.value(f, key, "0"));
      if (relation === "gifts") R.set(row, "points", R.value(f, ["emp_no", "points"], "0"));
      R.applyCustomerDiscount(row);
    }
    if (relation === "customers") {
      const balance = R.balance("customer", field.value);
      R.set(row, "pend_amt", R.money(balance)); R.set(row, "cust_name", R.value(f, "cust_name", record?.name));
      R.set(row, "custgst_no", R.value(f, ["cust_gstno", "gst_no"], "0"));
      R.set(row, "disc_offer", R.value(f, "disc_offer", "0")); R.set(row, "offerf_type", R.value(f, "offer_type", "Qty"));
      const alert = row.querySelector('[id^="crddue"],[id^="recbal"],[id^="pending"]'); if (alert) alert.textContent = `Due : ${R.format(balance)}`;
      const vehicle = R.field(row, "vehi_no") || R.field(row, "lubvehi_no");
      if (vehicle) { let list = row.querySelector("datalist"); if (!list) { list = document.createElement("datalist"); list.id = `ps-vehicles-${++rowCounter}`; vehicle.after(list); vehicle.setAttribute("list", list.id); } list.innerHTML = (state.masters.vehicles || []).filter(v => R.value(v.fields, ["customer_id", "cust_id"]) === record?.externalId).map(v => `<option value="${esc(v.name)}"></option>`).join(""); }
      R.applyCustomerDiscount(row);
    }
    if (relation === "employees") {
      if (module === "employee-recoveries") { R.set(row, "emp_balance", R.money(R.balance("employee", field.value))); R.set(row, "day_amount", R.money(R.dayEmployeeCash?.(field.value) || 0)); }
      if (context.module.id === "users") R.set(row, "employee_name", record?.name || "");
    }
    if (relation === "vendors") { R.set(row, "vend_gst", R.value(f, "gst_no")); }
    if (relation === "expiry-categories") R.set(row, "cat_id", record?.externalId || "");
    if (relation === "guests") {
      R.set(row, "guest_id", record?.externalId || ""); R.set(row, "gname", record?.name || ""); R.set(row, "mobileno", R.value(f, ["g_number", "g_mobileno"]));
      R.set(row, "bal_points", R.money(R.balance("loyalty", field.value, "quantity")));
    }
    R.calculateForm(field.form);
  };
  R.applyCustomerDiscount = row => {
    const customer = R.master("customers", related(row, "customers")?.value), product = related(row, "fuel-products")?.value;
    if (!customer) return;
    const offer = (state.masters["customer-discounts"] || []).find(record => R.value(record.fields, "customer_id") === customer.externalId && R.value(record.fields, "product") === product)?.fields || customer.fields;
    R.set(row, "disc_offer", R.value(offer, "disc_offer", "0")); R.set(row, "offerf_type", R.value(offer, "offer_type", "Qty"));
    row.dataset.psDiscount = R.value(offer, "disc_offer", "0"); row.dataset.psDiscountType = R.value(offer, "offer_type", "Qty");
  };
  function calculateRow(row, changed) {
    const module = R.base((row.tagName === "FORM" ? row : row.closest("form"))?.dataset.psModule || context.module.id), get = name => R.number(R.fieldValue(row, name, "0")), set = (name, value, digits = 2) => R.set(row, name, Number(value).toFixed(digits));
    if (["credit-sales", "guest-sales", "lubricant-sales", "handling-loss", "lubricant-loss", "gift-purchases"].includes(module)) {
      const lub = module.startsWith("lubricant"), gift = module === "gift-purchases", qtyName = lub ? "pro_qty1" : gift ? "qty" : "qnty", rateName = lub ? "pro_rate1" : "price", amountName = lub ? "pro_amt1" : "cost", discountName = lub ? "disc_amt" : module === "guest-sales" ? "disc" : "credit_discnt";
      let qty = get(qtyName), rate = get(rateName), discount = get(discountName);
      if (changed?.name === `${amountName}[]` || changed?.name === amountName) {
        const entered = get(amountName); qty = rate > 0 ? Number((entered / rate).toFixed(2)) : 0; set(qtyName, qty);
      }
      if ((changed?.name?.replace(/\[\]$/, "") === qtyName || changed?.dataset.psRelation === "customers" || changed?.dataset.psRelation === "fuel-products" || changed?.name?.replace(/\[\]$/, "") === amountName) && ["credit-sales", "guest-sales"].includes(module)) {
        const offer = R.number(row.dataset.psDiscount || R.fieldValue(row, "disc_offer", "0"));
        discount = row.dataset.psDiscountType === "Cash" ? qty * rate * offer / 100 : qty * offer; set(discountName, discount);
      }
      if (rate && qty) set(amountName, Math.max(0, qty * rate - discount));
      if (module === "guest-sales") {
        const offer = R.number(R.fieldValue(row, "disc_offer1", "0")); if (offer && !row.dataset.psDiscount) { discount = R.fieldValue(row, "offer_type1") === "Cash" ? qty * rate * offer / 100 : qty * offer; set("disc", discount); set("cost", qty * rate - discount); }
      }
      const meter = R.field(row, "sread"), lastRead = get("last_read"), lastQuantity = get("last_qty");
      if (meter && lastRead && lastQuantity) set("mileage", Math.max(0, get("sread") - lastRead) / lastQuantity);
    }
    if (module === "meter-sales") {
      const open = row.querySelector('[name^="open_read"]'), close = row.querySelector('[name^="close_read"]');
      if (open && close) { const gross = R.number(close.value) - R.number(open.value), test = R.number(row.querySelector('[name^="noz_test"]')?.value), rate = R.number(row.querySelector('[name^="sale_rate"]')?.value); const net = Math.max(0, gross - test);
        const grossField = row.querySelector('[name^="noz_gross"]'), quantityField = row.querySelector('[name^="noz_sale"]'), costField = row.querySelector('[name^="sale_amt"]');
        if (grossField) grossField.value = Math.max(0, gross).toFixed(2); if (quantityField) quantityField.value = close.value ? net.toFixed(2) : ""; if (costField) costField.value = close.value ? (net * rate).toFixed(2) : "";
      }
    }
    if (module === "fuel-purchases") {
      const qty = get("pro_qty"), rate = get("purrate"), basic = qty * rate;
      if (changed && !/purvat|purtcs|dealercomm|othertxs|lfr|cess|add_vat/.test(changed.name)) { set("purcost", basic); set("purvat", basic * get("vat_rate") / 100); set("lfr", qty / 1000 * get("lfr_rate")); }
      const taxable = basic + get("purvat") + get("othertxs");
      const product = R.master("fuel-products", R.fieldValue(row, "prod_code")); const tcsRate = R.number(product?.fields?.tcs || 0);
      if (tcsRate && changed && !/purtcs/.test(changed.name)) set("purtcs", taxable * tcsRate / 100);
      set("purtotal", taxable + get("purtcs")); set("inclrate", qty ? taxable / qty : 0);
    }
    if (module === "lubricant-purchases" || module === "other-purchases") {
      const qty = get("pur_proqty"), rate = get("pur_prorate"), basic = qty * rate;
      if (changed?.name?.includes("pur_disc_pct")) set("pur_disc", basic * get("pur_disc_pct") / 100);
      const taxable = Math.max(0, basic - get("pur_disc")), gst = get("gstrate");
      set("pur_proamt", basic); set("pur_billamt", taxable); set("tot_val", taxable);
      if (changed && !/pur_sgst|pur_cgst|pur_igst|pur_tcs/.test(changed.name)) { const sameState = R.fieldValue(row.form, "bunk_gst").slice(0, 2) === R.fieldValue(row.form, "vend_gst").slice(0, 2); set("pur_sgst", sameState ? taxable * gst / 200 : 0); set("pur_cgst", sameState ? taxable * gst / 200 : 0); set("pur_igst", sameState ? 0 : taxable * gst / 100); }
      set("pur_prototamt", taxable + get("pur_sgst") + get("pur_cgst") + get("pur_igst") + get("pur_tcs"));
    }
    if (module === "recoveries") set("balance", get("pend_amt") - get("paid_amt") - get("rec_disc_amt"));
    if (module === "employee-recoveries") set("shortage", Math.max(0, get("emp_balance") - get("recamnt")));
    if (module === "expenses") {
      const mode = R.fieldValue(row, "exp_paytype", "Cash"), flow = R.fieldValue(row, "flow", "Outflow");
      R.toggleFields(row, ["expbanktype_field"], /bank/i.test(mode)); R.toggleFields(row, ["expvendtype_field"], /vendor/i.test(mode));
      R.toggleFields(row, ["partyname_field"], /party/i.test(mode));
      const type = R.master("expense-types", R.fieldValue(row, "exp_type"));
      if (changed?.dataset.psRelation === "expense-types") R.set(row, "flow", /income|inflow/.test(R.value(type?.fields, "effect_income")) ? "Inflow" : flow);
      R.toggleFields(row, ["exppartytype"], R.fieldValue(row, "expeffectasst") === "Yes");
    }
    if (module === "credit-sales") R.toggleFields(row, ["partytype"], R.fieldValue(row, "effectasst") === "Yes");
    if (module === "recoveries" || module === "guest-sales") {
      const mode = R.fieldValue(row, module === "recoveries" ? "re_type" : "coll_type", "Cash");
      R.ensurePaymentSelect?.(row, mode, module === "recoveries" ? "banktype_field" : "coll_name");
    }
    if (module === "lubricant-sales") R.toggleFields(row, ["org_name", "lubvehi_no", "ind_no"], /credit/.test(R.fieldValue(row, "sale_type1", "Cash").toLowerCase()));
  }
  R.calculateForm = (form, changed) => {
    if (!form || form.dataset.psOperation === "report" || form.dataset.psOperation === "filter" || form.dataset.psOperation === "profile") return;
    const module = R.base(form.dataset.psModule || context.module.id), rows = R.formRows(form), sum = name => rows.reduce((total, row) => total + R.number(R.fieldValue(row, name, "0")), 0), set = (name, value) => R.set(form, name, R.money(value));
    for (const row of rows) calculateRow(row, changed && row.contains(changed) ? changed : undefined);
    if (module === "credit-sales" || module === "guest-sales") { set("tot_cost", sum("cost")); set("tot_quant", sum("qnty")); set("totamt_batta", sum("batta_amt")); set("tot_discnt", sum("credit_discnt")); }
    if (module === "lubricant-sales") set("sale_total", sum("pro_amt1"));
    if (module === "swipes") set("tot_swiamt", sum("swipe_amt"));
    if (module === "expenses") {
      const incoming = rows.filter(row => /inflow/i.test(R.fieldValue(row, "flow"))), outgoing = rows.filter(row => !/inflow/i.test(R.fieldValue(row, "flow")));
      const total = list => list.reduce((value, row) => value + R.number(R.fieldValue(row, "exp_amt", "0")), 0);
      set("tot_expcash", sum("exp_amt")); set("exp_out", total(outgoing.filter(row => R.fieldValue(row, "exp_paytype", "Cash") === "Cash"))); set("exp_in", total(incoming.filter(row => R.fieldValue(row, "exp_paytype", "Cash") === "Cash")));
      set("exp_outbanktot", total(outgoing.filter(row => R.fieldValue(row, "exp_paytype", "Cash") !== "Cash"))); set("exp_bankintot", total(incoming.filter(row => R.fieldValue(row, "exp_paytype", "Cash") !== "Cash")));
    }
    if (module === "recoveries") set("tot_recoveramnt", sum("paid_amt"));
    if (module === "employee-recoveries") set("tot_recoveramnt", sum("recamnt"));
    if (module === "fuel-purchases") { set("tot_cost", sum("purcost")); set("tot_vat", sum("purvat")); set("tot_tcs", sum("purtcs")); set("tot_othertxs", sum("othertxs")); set("total_amt", sum("purtotal") + R.number(R.fieldValue(form, "roundingoff", "0")) - sum("dealercomm")); }
    if (module === "lubricant-purchases" || module === "other-purchases") { set("puritems_amt", sum("pur_proamt")); set("discnt", sum("pur_disc")); set("igst", sum("pur_igst")); set("cgst", sum("pur_cgst")); set("sgst", sum("pur_sgst")); set("tcstxs", sum("pur_tcs")); set("invoice_tot", sum("pur_prototamt") - R.number(R.fieldValue(form, "cashdisc", "0")) + R.number(R.fieldValue(form, "roundoff", "0"))); }
    if (module === "gift-purchases") set("tot_quant", sum("qty"));
    if (module === "meter-sales") {
      let total = 0; for (const input of form.querySelectorAll('[name^="sale_amt_"]')) total += R.number(input.value); set("totlqsale_amt", total);
      for (const product of state.masters["fuel-products"] || []) {
        const totals = { gross: 0, test: 0, net: 0, amt: 0 };
        for (const row of rows.filter(row => row.querySelector(`[name="nozprod_id_${product.externalId}[]"]`))) { totals.gross += R.number(row.querySelector('[name^="noz_gross"]')?.value); totals.test += R.number(row.querySelector('[name^="noz_test"]')?.value); totals.net += R.number(row.querySelector('[name^="noz_sale"]')?.value); totals.amt += R.number(row.querySelector('[name^="sale_amt"]')?.value); }
        for (const [key, value] of Object.entries(totals)) { const target = document.getElementById(`${key}${product.externalId}`) || document.getElementById(`${key}_${product.externalId}`); if (target) target.textContent = R.format(value); }
      }
    }
    if (module === "settlements") R.calculateSettlement?.(form);
  };
  R.dayEmployeeCash = id => {
    const employee = R.master("employees", id); return R.number(employee?.fields?.balance || 0);
  };
  R.sourceForm = index => R.cleanClone(sourceForms.get(String(index))?.cloneNode(true));
  R.editRecord = async entry => {
    if (R.specialEdit && await R.specialEdit(entry)) return;
    const schema = context.module.forms.find(form => form.operation === "save" && form.fields.some(field => field.type !== "hidden" && field.type !== "file")) || context.module.forms.find(form => form.operation === "save");
    if (!schema || !schema.fields.length) return R.auxDialog?.(entry.module, entry);
    const form = R.sourceForm(schema.index); if (!form) return;
    form.dataset.psEdit = entry.id; form.dataset.psModule = entry.module;
    const f = entry.fields || {}, rows = R.formRows(form), items = Array.isArray(f.items) ? f.items : [f];
    if (items.length > 1 && rows[0] !== form) { const original = rows[0]; for (const other of rows.slice(1)) other.remove(); for (const item of items.slice(1)) { const copy = R.renumber(original.cloneNode(true)); original.parentElement.append(copy); } }
    const editableRows = R.formRows(form);
    R.fillRelations(form);
    for (const field of form.querySelectorAll("input,select,textarea")) {
      if (!field.name || field.type === "file" || field.type === "password" || /Pwd$|^pwd$/.test(field.name)) { if (field.type === "password") { field.required = false; field.value = ""; } continue; }
      const rowIndex = editableRows.findIndex(row => row !== form && row.contains(field)), data = rowIndex >= 0 ? { ...f, ...(items[rowIndex] || f) } : f;
      const base = field.name.replace(/\[\]$/, ""); let value = data[field.name] ?? data[base];
      const alias = { insert_date: entry.date, pur_date: entry.date, trans_dt: entry.date, price: entry.rate, pro_rate1: entry.rate, pro_qty1: entry.quantity, qnty: entry.quantity, pro_amt1: entry.amount, cost: entry.amount, pur_proname1: data.product, prod_code: data.product, pro_qty: data.quantity, purrate: data.rate, pur_proqty: data.quantity, pur_prorate: data.rate, pur_disc: data.discount };
      if (value === undefined) value = alias[base];
      if (value !== undefined) {
        if (field.type === "checkbox" || field.type === "radio") field.checked = Array.isArray(value) ? value.map(String).includes(field.value) : String(value) === field.value;
        else field.value = Array.isArray(value) ? value[0] || "" : value;
      }
    }
    R.hydrateChildren?.(form, entry);
    const body = R.dialog(`Edit ${context.module.title}`, form); R.initWidgets(body); R.calculateForm(form); await R.initLoan?.(form, entry);
  };
  async function attachments(form, fields) {
    for (const input of form.querySelectorAll('input[type="file"]')) {
      if (!input.files.length) continue;
      const uploaded = [];
      for (const file of input.files) {
        const body = new FormData(); body.set("file", file); body.set("module", form.dataset.psModule || context.module.id);
        const response = await fetch("/api/petrosoft/attachment", { method: "POST", body, credentials: "same-origin" }); const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to upload file."); uploaded.push(result.id);
      }
      fields[input.name] = input.name.endsWith("[]") || uploaded.length > 1 ? uploaded : uploaded[0];
      fields.attachments = [...(fields.attachments || []), ...uploaded];
    }
  }
  R.submitForm = async form => {
    if (form.dataset.psBusy) return;
    R.reindex(form);
    const index = Number(form.dataset.psForm), schema = form.dataset.psSchema ? JSON.parse(form.dataset.psSchema) : context.module.forms.find(item => item.index === index), operation = form.dataset.psOperation || schema?.operation || "save", fields = R.readForm(form);
    form.dataset.psBusy = "1"; form.classList.add("ps-submit-busy");
    try {
      if (operation === "filter") { await R.refresh(fields); return; }
      if (operation === "report") { await R.openReport(index, fields); return; }
      if (operation === "import") { await R.importForm(form, schema); return; }
      if (operation === "profile") { await R.saveProfile(form); return; }
      if (context.module.id === "backup") { await R.download("/api/petrosoft/backup", { operation: "backup" }, "Petrosoft-backup.json"); return; }
      await attachments(form, fields);
      if (R.specialSubmit && await R.specialSubmit(form, schema, fields)) return;
      const result = await R.api("/api/petrosoft/action", { module: form.dataset.psModule || context.module.id, operation: "save", formIndex: index, action: schema?.action, id: form.dataset.psEdit || undefined, fields });
      R.notice(result.message); if (result.redirect) return R.destination(result.redirect);
      if (form.dataset.psEdit || form.dataset.psAux) R.closeDialog();
      else { for (const field of form.querySelectorAll('input:not([type="hidden"]):not([readonly]),textarea')) if (!/date|_dt/.test(field.name) && field.type !== "file") field.value = /cost|amt|discount|qty|qnty/.test(field.name) ? "0" : ""; }
      await R.refresh();
    } catch (error) { R.notice(error.message, "error"); }
    finally { delete form.dataset.psBusy; form.classList.remove("ps-submit-busy"); }
  };
  document.addEventListener("submit", event => {
    const form = event.target;
    if (form.matches("form[data-ps-form]") && !form.dataset.psCustom) { event.preventDefault(); R.calculateForm(form); R.submitForm(form); }
  }, true);
  document.addEventListener("input", event => {
    const field = event.target;
    if (!field.form || !field.form.matches("[data-ps-form]")) return;
    if (!field.tomselect) R.calculateForm(field.form, field);
    if (/^denom_\d+/.test(field.name)) R.calculateDenominations?.(field);
  });
  document.addEventListener("change", event => {
    const field = event.target;
    if (!field.form) return;
    if (field.dataset.psRelation) R.relationChanged(field);
    else R.calculateForm(field.form, field);
    if ((field.name === "insert_date" || field.name === "pur_date") && !field.closest(".ps-dialog")) R.formDateChanged?.(field.value);
    if (field.type === "file" && field.files[0]) {
      const maximum = 20 * 1024 * 1024; if (field.files[0].size > maximum) { field.value = ""; R.notice("Choose a file smaller than 20 MB.", "error"); }
    }
  });
  document.addEventListener("click", event => {
    const control = event.target.closest("button,a,input[type=button]"); if (!control || !control.closest("form[data-ps-form]")) return;
    if (/add_field_button|add_fields|add-row|add_row_button/.test(control.className) || control.dataset.psAddRow) { event.preventDefault(); R.addRow(control); }
    if (/remove_field|remove-row/.test(control.className) || control.dataset.psRemoveRow) {
      event.preventDefault(); const row = control.closest("[data-ps-row]"), form = control.closest("form"); if (row && R.formRows(form).length > 1) row.remove(); else if (row) for (const field of row.querySelectorAll("input:not([type=hidden]),select,textarea")) { if (field.tomselect) field.tomselect.clear(); else field.value = ""; } R.calculateForm(form);
    }
  });
})();
