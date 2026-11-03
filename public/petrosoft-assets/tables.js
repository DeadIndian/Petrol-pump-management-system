(function () {
  "use strict";
  const R = window.PetrosoftRuntime;
  if (!R) return;
  const { state, context, esc, $ } = R;
  const icons = { edit: "edit.png", delete: "delete.png" };
  const button = (entry, action, label, icon) => {
    const operation = ["edit", "delete", "toggle"].includes(action) ? action : action === "permissions" || action.startsWith("provider-") ? "edit" : "view";
    if (!R.can(action.startsWith("provider-") ? context.module.id : entry.module, operation)) return "";
    return `<button type="button" data-ps-record="${esc(entry.id)}" data-ps-record-module="${esc(entry.module)}" data-ps-action="${action}" title="${esc(label)}" aria-label="${esc(label)}">${icon && icons[icon] ? `<img src="/petrosoft-assets/assets/images/${icons[icon]}" alt="">` : esc(label)}</button>`;
  };
  const field = (entry, names, fallback = "") => R.value(entry.fields, names, fallback);
  const normalize = label => label.toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]/g, "");
  R.cell = (entry, heading, index, rowIndex) => {
    const label = normalize(heading), module = entry.module, f = entry.fields || {}, amount = entry.amount, count = entry.quantity;
    if (!label || label === "all") return `<input type="checkbox" data-ps-select="${esc(entry.id)}" aria-label="Select entry ${esc(entry.number)}">`;
    if (/^(sno|slno)$/.test(label)) return String(rowIndex + 1);
    if (label === "action" || label === "actions") return `<div class="ps-table-actions">${button(entry, "edit", "Edit", "edit")}${button(entry, "delete", "Delete", "delete")}${module === "roles" ? button(entry, "permissions", "View") : ""}</div>`;
    if (label === "edit") return `<div class="ps-table-actions">${button(entry, "edit", "Edit", "edit")}</div>`;
    if (label === "delete") return `<div class="ps-table-actions">${button(entry, "delete", "Delete", "delete")}</div>`;
    if (label === "status") return `<div class="ps-table-actions">${["brs", "vrs"].includes(module) ? button(entry, "reconcile", f.reconciled ? "Reconciled" : "Pending") : button(entry, "toggle", entry.status === "active" ? "Activated" : "Deactivated")}</div>`;
    if (["view", "itemsview", "details", "settlement"].includes(label)) return `<div class="ps-table-actions">${button(entry, "view", label === "settlement" ? "View" : heading)}</div>`;
    if (label === "addnozzles") return `<div class="ps-table-actions">${button(entry, "nozzles", "Add Nozzles")}</div>`;
    if (label === "vehicles") return `<div class="ps-table-actions">${button(entry, "vehicles", "Vehicles")}</div>`;
    if (label === "interestinfo") return `<div class="ps-table-actions">${button(entry, "customer-interest", "Interest Info")}</div>`;
    if (label === "pfesiit") return `<div class="ps-table-actions">${button(entry, "employee-benefits", "PF / ESI / IT")}</div>`;
    if (label === "incentives") return `<div class="ps-table-actions">${button(entry, "pump-incentives", "Incentives")}</div>`;
    if (label === "viewlist") return `<div class="ps-table-actions">${button(entry, "expiry-renewals", "View List")}</div>`;
    if (label === "generate" || label === "cancel" || label === "cancelewb") return `<div class="ps-table-actions">${button(entry, label === "generate" ? "provider-generate" : "provider-cancel", heading)}</div>`;
    if (/image|picture/.test(label)) {
      const attachments = f.attachments || []; const id = field(entry, ["attachment_id", "image_id"], Array.isArray(attachments) ? attachments[0] : "");
      return id ? `<a href="/api/petrosoft/attachment/${encodeURIComponent(id)}" target="_blank" rel="noopener" aria-label="View image"><i class="icon-image2"></i></a>` : "";
    }
    if (/^(userlogdetails|logs|user)$/.test(label)) return `<div class="ps-user-log">${esc(entry.createdBy)}${entry.updatedAt !== entry.createdAt ? `<br><small>${esc(entry.updatedAt.slice(0, 10))}</small>` : ""}</div>`;
    if (/^(date|saledate|invoicedate|purchasedate|transactiondate|dumpdate|requestdate|statementdate)$/.test(label)) return esc(entry.date);
    if (label === "fromdatetodate") return esc(`${field(entry, "frm_dt")} - ${field(entry, "to_dt")}`);
    if (/^(txnno|trxno|trxnno|txnn?o|trxnno|reffno|referenceno|stno)$/.test(label)) return esc(field(entry, ["ref_no", "transaction_no", "invoice_number"], String(entry.number).padStart(module === "statement-records" ? 6 : 1, "0")));
    if (label === "invoiceno") return esc(field(entry, ["invo_no", "invoiceno", "invoice_no", "invoice"]));
    if (/^(organization|orgcust|customername)$/.test(label)) return esc(module === "customers" ? entry.name : field(entry, ["organization_name", "cust_name", "gname", "customer_name"]));
    if (label === "represent") return esc(field(entry, "cust_name"));
    if (/^(empname|employee|employeename)$/.test(label)) return esc(module === "employees" ? entry.name : field(entry, "employee_name"));
    if (/^(vendor|vendorname)$/.test(label)) return esc(module === "vendors" ? entry.name : field(entry, "vendor_name"));
    if (/^(product|productname)$/.test(label)) return esc(["fuel-products", "lubricants"].includes(module) ? entry.name : field(entry, "product_name", entry.name));
    if (label === "shortname") return esc(field(entry, ["short_name", "Short_name"]));
    if (label === "bank" || label === "partyname" || label === "effectparties") {
      const id = field(entry, ["partyname_field", "partytype", "bank_id", "crd_id"]).split("|")[0], from = R.master("business-parties", id)?.name || id;
      const to = R.master("business-parties", field(entry, "Topartytype").split("|")[0])?.name;
      return esc(to && label === "effectparties" ? `${from} → ${to}` : field(entry, "party_name", from));
    }
    if (label === "rolename") return esc(entry.name);
    if (label === "userrole") return esc(R.master("roles", field(entry, ["role", "user_role"]))?.name || field(entry, ["role", "user_role"]));
    if (label === "username") return esc(field(entry, ["user_name", "username"], entry.name));
    if (label === "password") return "••••••••";
    if (label === "applogin") return esc(field(entry, ["u_name", "username"]));
    if (label === "mobileno" || label === "mobilenum" || label === "phonenumber" || label === "phonenum" || label === "number") return esc(field(entry, ["emp_ph_no", "phone_no", "ven_phno", "mobile", "g_number", "phn", "phone"]));
    if (label === "email") return esc(field(entry, ["eml", "email", "ven_eml", "g_email"]));
    if (label === "address") return esc(field(entry, ["org_address", "emp_addrs", "vend_details", "address", "g_address"]));
    if (label === "designation") return esc(field(entry, "designation"));
    if (label === "aadhaarnum") return esc(field(entry, ["aadhaar_no", "adhar_no"]));
    if (label === "empnum") return esc(field(entry, "emp_no"));
    if (label === "salary" || label === "totalsalary") return R.format(field(entry, ["salary", "total_salary", "net_salary"], amount));
    if (label === "shortagelimit") return R.format(field(entry, ["emp_limit", "shortage_limit"]));
    if (/^(price|rate|productrate|salerate)$/.test(label)) return R.format(field(entry, ["price", "sale_rate"], entry.rate));
    if (label === "closingrate") return R.format(field(entry, "cls_rate", entry.rate));
    if (label === "variationamt") return R.format(field(entry, ["var_amt", "v_amt", "vari_amnt"]));
    if (/^(quantity|qty|netsale|sold|netsaleqty|order edunit)$/.test(label)) return R.format(count);
    if (label === "assigned") return R.format(field(entry, ["qunt", "Assign_qty", "quantity"], count));
    if (label === "collected") return R.format(field(entry, ["recamnt", "collected"], amount));
    if (label === "shortage") return R.format(field(entry, "shortage"));
    if (label === "balance" || label === "balanceamount") return R.format(field(entry, ["balance", "close_stock", "closing"], count));
    if (label === "bus icash" || label === "busicash") return R.format(field(entry, "day_amount"));
    if (/^(amount|cost|saleamount|paidamt|credit|debit|billamount)$/.test(label)) {
      if (module === "vendor-transactions" && /^(credit|debit)$/.test(label)) return field(entry, "trans_type").toLowerCase() === label ? R.format(amount) : "0";
      return R.format(label === "cost" ? field(entry, "cost", amount) : amount);
    }
    if (label === "discount" || label === "offeramount") return R.format(field(entry, ["discount", "credit_discnt", "disc_offer", "disc_amt"]));
    if (label === "cashdiscount") return R.format(field(entry, ["cashdisc", "cashdisocunt"]));
    if (label === "testqty") return R.format(field(entry, ["test_qty", "noz_test"]));
    if (label === "misccharges") return R.format(field(entry, ["misc_charges", "batta_amt", "batta"]));
    if (label === "indentno") return esc(field(entry, ["indent_no", "ind_no", "s_pro_indentno"]));
    if (label === "billno" || label === "billnumber") return esc(field(entry, ["credit_billno", "billno", "bill_no", "s_pro_billno"]));
    if (label === "vehicleno" || label === "vehiclenumber" || label === "vehicle") return esc(field(entry, ["vehi_no", "vehicle_no", "lubvehi_no", "s_vehicle_no"]));
    if (label === "tank" || label === "tankname") return esc(field(entry, "tank_name", entry.name));
    if (label === "tankcapacity") return R.format(field(entry, ["tank_cap", "capacity"]));
    if (label === "nozzle") return esc(field(entry, "nozzle_name", field(entry, "noz")));
    if (label === "pump" || label === "pumpstation") return esc(field(entry, ["pump", "pump_name", "sale_pump"]));
    if (label === "displayorder") return `<input class="form-control input-sm" type="number" value="${esc(field(entry, "pump_order", "0"))}" min="0" data-ps-order="${esc(entry.id)}" aria-label="Display order">`;
    if (label === "meterreading") return `<div>Open : ${esc(field(entry, "open_read"))}<br>Close : ${esc(field(entry, "close_read"))}</div>`;
    if (label === "hsncode") return esc(field(entry, "hsn_code"));
    if (["vat", "tcs", "gst", "lfrkl", "mrprate", "minimumstock", "minimumquantity", "presentstock", "purchase", "sale", "loss", "stock"].includes(label)) {
      const keys = { lfrkl: "lfr", mrprate: "mrp_rate", minimumstock: "min_quantity", minimumquantity: "min_quantity", presentstock: "present_stock" };
      return R.format(field(entry, keys[label] || label, label === "stock" ? count : "0"));
    }
    if (label === "categorytype") return esc(field(entry, ["cust_category", "category"]));
    if (label === "openingdetails" || label === "openingbalance") return `${esc(field(entry, ["amount_type", "opening_type", "amount_des"], "Due"))} : ${R.format(field(entry, "open_bal"))}<br><small>${esc(field(entry, "open_dt"))}</small>`;
    if (label === "limit") return R.format(field(entry, "credit_limit"));
    if (label === "advance") return esc(field(entry, ["org_advance", "adv_input", "advance"], "0"));
    if (label === "batchno") return esc(field(entry, ["swp_billno", "swp_batchno"]));
    if (label === "swipe" || label === "machinename") return esc(module === "swipe-machines" ? entry.name : field(entry, "swipe_name"));
    if (label === "attachedtype") return esc(field(entry, "attach_type"));
    if (label === "expensestype" || label === "expensesname") return esc(module === "expense-types" ? entry.name : field(entry, "expense_name"));
    if (label === "flow") return esc(field(entry, "flow", "Outflow"));
    if (label === "mode" || label === "paymentmode") return esc(field(entry, ["exp_paytype", "re_type", "collection_mode", "coll_type", "payment_mode"], "Cash"));
    if (label === "paymenttype" || label === "type" || label === "partytype" || label === "saletype") return esc(field(entry, ["sale_type1", "sale_type", "p_type", "vend_type", "effectemp", "d_type", "type", "collection_type"]));
    if (label === "effectasset") return esc(field(entry, ["effectasst", "expeffectasst", "effect_asset"], "No"));
    if (label === "by") return esc(field(entry, ["payment_mode", "exp_paytype", "bank", "entry_mode"], "Cash"));
    if (label === "paidto") return esc(R.master("employees", field(entry, "pay_emply"))?.name || field(entry, "party_name"));
    if (label === "deposit") return esc(field(entry, "re_type", "Cash"));
    if (label === "bunkname" || label === "name" || label === "giftname" || label === "tiername" || label === "itemname") return esc(entry.name);
    if (label === "gstno" || label === "gstin" || label === "gsttinno") return esc(field(entry, ["cust_gstno", "gst_no", "gstin", "gst_fill"]));
    if (label === "maxpoints" || label === "pointsqty" || label === "points" || label === "giftpoints") return R.format(field(entry, ["points_rate", "points", "emp_no", "points_balance"]));
    if (label === "uniquenumber") return esc(field(entry, "item_number"));
    if (label === "category") return esc(field(entry, "category_name", R.master("expiry-categories", field(entry, "cat_id"))?.name || ""));
    if (label === "expirydate") return esc(field(entry, "exp_date"));
    if (label === "daysbeforealert") return esc(field(entry, "alert_days"));
    if (label === "totalpresents") return esc(field(entry, "presents", "0"));
    if (label === "totalabsents") return esc(field(entry, "absents", "0"));
    if (label === "year" || label === "month") return esc(field(entry, label, label === "year" ? entry.date.slice(0, 4) : entry.date.slice(5, 7)));
    if (label === "totalemployee") return esc(field(entry, "total_employees", "0"));
    if (label === "module") return esc(field(entry, "module", entry.name));
    if (label === "event") return esc(field(entry, "event"));
    if (label === "trxid") return esc(field(entry, "entry_id"));
    if (label === "eventtime") return esc(field(entry, "event_time"));
    if (label === "createddate") return esc(entry.createdAt.slice(0, 10));
    if (label === "ipaddress") return "";
    if (label === "shift") return esc(field(entry, "shift", "S-1"));
    if (label === "entrysource") return esc(field(entry, "entry_source", entry.createdBy));
    if (label === "mileage") return R.format(field(entry, ["mileage", "milleage"]));
    if (/^(description|note|remarks)$/.test(label)) return esc(field(entry, ["desc", "descript", "description", "rec_desc", "swipe_des", "lubdesc", "emprec_desc", "trans_desc", "hand_des", "emp_desc", "crd_desc", "role_description", "descp"]));
    const mapping = { openingstock: "open_stock", openstock: "open_stock", receipt: "receipt", totalstock: "total_stk", metersale: "meter_sale", closedstock: "close_stock", closingstock: "close_stock", variation: "stk_variation", dipdetails: "dip_stock", stockdump: "stock_dump", openbalance: "opencash", closebalance: "closecash", daybusicashinhand: "finialbankamt", metersaleamount: "meter_sale", lubsale: "lubricant_sale", recovery: "recovery", cashin: "cash_in", totalcash: "total_cash", expenses: "expenses", recoverybank: "bank_recovery", handcash: "hand_cash", limitfixed: "credit_limit", balancedue: "balance", fromtime: "from_time", totime: "to_time", duties: "duties", denomination: "d_val", previousstock: "prevs_stock", currentstock: "dip_stock", cr: "close_read", or: "open_read", testing: "test_qty", assigned: "qunt" };
    if (mapping[label]) return R.format(field(entry, mapping[label]));
    const column = context.module.tables.find(table => table.headers[index] === heading)?.columns?.[index];
    return esc(column ? field(entry, column) : field(entry, [heading, label], ""));
  };
  R.download = async (url, body, fallback = "export.xlsx") => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
    if (!response.ok) { const result = await response.json(); throw new Error(result.error || "Export failed."); }
    const blob = await response.blob(), object = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = object; link.download = response.headers.get("content-disposition")?.match(/filename="?([^";]+)"?/)?.[1] || fallback;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(object), 1000);
  };
  R.exportModule = async format => {
    try { await R.download("/api/petrosoft/export", { module: context.module.id, format, filters: state.filters }, `${context.module.id}.${format}`); }
    catch (error) { R.notice(error.message, "error"); }
  };
  R.renderTables = () => {
    for (const schema of context.module.tables) {
      const table = document.getElementById(schema.id);
      if (!table) continue;
      if ($?.fn.dataTable?.isDataTable(table)) $(table).DataTable().destroy();
      const rows = state.tables?.[schema.id] || state.records || [];
      const tbody = table.tBodies[0] || table.createTBody();
      tbody.innerHTML = rows.map((entry, rowIndex) => `<tr data-ps-id="${esc(entry.id)}">${schema.headers.map((heading, index) => `<td>${R.cell(entry, heading, index, rowIndex)}</td>`).join("")}</tr>`).join("");
      table.querySelectorAll("thead input[type=checkbox]").forEach(checkbox => { checkbox.setAttribute("aria-label", "Select all entries"); checkbox.onchange = () => table.querySelectorAll("[data-ps-select]").forEach(input => { input.checked = checkbox.checked; }); });
      if ($?.fn.DataTable) {
        $(table).DataTable({ pageLength: 10, order: [], autoWidth: false, scrollX: true, deferRender: true,
          dom: "Bflrtip", buttons: R.can(context.module.id, "export") ? [
            { text: "Copy", action: () => { navigator.clipboard?.writeText(table.innerText).then(() => R.notice("Table copied.")); } },
            { text: "Excel", action: () => R.exportModule("xlsx") }, { text: "PDF", action: () => R.exportModule("pdf") },
            { text: "Print", action: () => R.printTable(table, context.module.title) },
          ] : [], language: { emptyTable: "No data available in table", search: "Search:", lengthMenu: "Show _MENU_ entries" } });
      }
    }
  };
  R.printTable = (table, title) => {
    const copy = table.cloneNode(true); copy.querySelectorAll("button,input").forEach(node => node.remove());
    const body = R.dialog(title, copy, '<button class="btn btn-primary" type="button" data-ps-print>Print</button>');
    body.parentElement.querySelector("[data-ps-print]").onclick = () => window.print();
  };
  R.record = id => (state.records || []).find(entry => entry.id === id) || Object.values(state.tables || {}).flat().find(entry => entry.id === id) || Object.values(state.masters || {}).flat().find(entry => entry.id === id);
  R.detail = entry => {
    const f = entry.fields || {}, schema = context.module.forms.find(form => form.operation === "save"), fields = schema?.fields || [];
    const labels = new Map(fields.map(field => [field.name.replace(/\[\]$/, ""), field.label || field.name]));
    const preferred = { date: entry.date, name: entry.name, amount: R.format(entry.amount), quantity: R.format(entry.quantity), rate: R.format(entry.rate), ...f };
    let html = '<dl class="ps-record-detail">';
    for (const [key, value] of Object.entries(preferred)) {
      if (key.startsWith("_") || /password|pwd|token|^items$|^rows$|^details$|^attachments$/.test(key) || value === null || value === "" || typeof value === "object") continue;
      html += `<dt>${esc(labels.get(key) || key.replace(/_/g, " "))}</dt><dd>${esc(value)}</dd>`;
    }
    html += "</dl>";
    if (Array.isArray(f.items)) html += `<div class="table-responsive"><table class="ps-report-table"><thead><tr><th>Product</th><th>Quantity</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${f.items.map(item => `<tr><td>${esc(R.master(/lubricant/.test(entry.module) ? "lubricants" : /gift/.test(entry.module) ? "gifts" : "fuel-products", R.value(item, ["product", "prod_code", "pur_proname1"]))?.name || R.value(item, ["product_name", "product"]))}</td><td>${R.format(R.value(item, ["quantity", "pro_qty"]))}</td><td>${R.format(R.value(item, ["rate", "price"]))}</td><td>${R.format(R.value(item, ["amount", "total_amount"]))}</td></tr>`).join("")}</tbody></table></div>`;
    const body = R.dialog(context.module.title, html, '<button type="button" class="btn btn-primary" data-ps-print>Print</button>');
    body.parentElement.querySelector("[data-ps-print]").onclick = () => window.print();
  };
  document.addEventListener("click", async event => {
    const control = event.target.closest("[data-ps-action]");
    if (!control) return;
    event.preventDefault(); const entry = R.record(control.dataset.psRecord); if (!entry) return;
    const action = control.dataset.psAction;
    if (action === "view") { if (entry.module === "statement-records" || entry.module === "generated-invoices") return R.openDocument?.(entry); if (entry.module === "attendance") return R.attendanceDialog?.(entry); if (entry.module === "payroll") return R.payrollDetail?.(entry); return R.detail(entry); }
    if (action === "edit") return R.editRecord?.(entry);
    if (["delete", "toggle", "reconcile"].includes(action)) return R.confirm(action === "delete" ? "Delete this entry and update its related balances?" : action === "reconcile" ? "Mark this transaction as reconciled?" : "Change the status of this entry?", async () => {
      const result = await R.api("/api/petrosoft/action", { module: entry.module, operation: action, id: entry.id }); R.notice(result.message); await R.refresh();
    });
    if (action.startsWith("provider-")) return R.providerDialog?.(entry, action);
    return R.auxDialog?.(action, entry);
  });
  document.addEventListener("change", async event => {
    const input = event.target.closest("[data-ps-order]"); if (!input) return;
    const entry = R.record(input.dataset.psOrder);
    try { await R.api("/api/petrosoft/action", { module: "pump-settings", id: entry.id, fields: { ...entry.fields, pump_order: input.value } }); R.notice("Display order saved."); }
    catch (error) { R.notice(error.message, "error"); }
  });
})();
