(function () {
  "use strict";
  const R = window.PetrosoftRuntime;
  if (!R) return;
  const { state, context, esc } = R;
  const fragments = new Map();
  R.array = (fields, name) => { const value = fields[`${name}[]`] ?? fields[name]; return value === undefined ? [] : Array.isArray(value) ? value : [value]; };
  R.fragment = async name => {
    if (!fragments.has(name)) fragments.set(name, fetch(`/petrosoft-assets/fragments/${encodeURIComponent(name)}.html`).then(async response => { if (!response.ok) throw new Error("Unable to load this form."); return response.text(); }));
    const parsed = new DOMParser().parseFromString(await fragments.get(name), "text/html");
    return parsed.body;
  };
  R.localForm = (form, module, entry) => {
    if (!form) throw new Error("This form is unavailable.");
    form.dataset.psForm = "-1"; form.dataset.psModule = module; form.dataset.psOperation = "save"; form.dataset.psAux = "1";
    form.action = "/api/petrosoft/action"; form.method = "post";
    if (entry?.id) form.dataset.psEdit = entry.id;
    for (const field of form.querySelectorAll('[name$="[]"]')) {
      if (field.type === "hidden") continue;
      const row = field.closest(".benchmark-row,.form-group,.product_info,.kgn-details-grids");
      if (row && row !== form && !row.closest("[data-ps-row]")) row.dataset.psRow = "1";
    }
    form.querySelectorAll(".add_field_button1,.nozz_add_field").forEach(control => { control.dataset.psAddRow = "1"; control.type = "button"; });
    return form;
  };
  R.populate = (form, entry) => {
    const f = entry?.fields || entry || {};
    for (const input of form.querySelectorAll("[name]")) {
      const name = input.name.replace(/\[\]$/, "").replace(/\[\d+\]$/, "");
      const aliases = { join_dt: entry?.date, date: entry?.date, insert_date: entry?.date, pur_date: entry?.date, trans_dt: entry?.date, org_name: entry?.name, emp_name: entry?.name, swipe_name: entry?.name, tank_name: entry?.name, role_name: entry?.name };
      const value = f[input.name] ?? f[name] ?? aliases[name];
      if (input.type === "password" || input.type === "file") { input.required = false; continue; }
      if (value === undefined) continue;
      if (input.type === "checkbox" || input.type === "radio") input.checked = Array.isArray(value) ? value.map(String).includes(input.value) : String(value) === input.value;
      else input.value = Array.isArray(value) ? value[0] ?? "" : value;
    }
  };
  R.childTable = (table, entries, headings) => {
    if (!table) return;
    if (R.$?.fn.dataTable?.isDataTable(table)) R.$(table).DataTable().destroy();
    const columns = headings || Array.from(table.querySelectorAll("thead th")).map(cell => cell.textContent.trim());
    const body = table.tBodies[0] || table.createTBody();
    body.innerHTML = entries.map((entry, index) => `<tr>${columns.map((heading, column) => `<td>${R.cell(entry, heading, column, index)}</td>`).join("")}</tr>`).join("");
  };
  R.ensurePaymentSelect = (row, mode, name) => {
    let field = R.field(row, name);
    if (!field) return;
    const relation = /vendor|card/i.test(mode) ? "vendors" : /swipe|pos/i.test(mode) ? "swipe-machines" : /bank/i.test(mode) ? "business-parties" : "";
    const parent = field.closest('[class*="col-md-"],[class*="col-sm-"]') || field.parentElement;
    if (parent) parent.style.display = relation ? "" : "none";
    if (!relation) { field.required = false; return; }
    if (field.tagName !== "SELECT") {
      const select = document.createElement("select"); select.name = field.name; select.id = field.id; select.className = "form-control tom"; field.replaceWith(select); field = select;
    }
    if (field.dataset.psRelation !== relation) { field.tomselect?.destroy(); field.dataset.psRelation = relation; field.innerHTML = '<option value="">Choose Type</option>'; R.fillRelations(row); R.initWidgets(row); }
    field.required = true;
  };
  R.renderMeter = async (form = document.querySelector('form[data-ps-form="1"]'), selected, existing) => {
    if (!form) return;
    const holder = form.querySelector("#noz1") || form.querySelector("[data-ps-meter-holder]");
    if (!holder) return;
    const source = (await R.fragment("meter")).querySelector("[data-ps-row]");
    if (!source) return;
    const readings = selected || state.nozzles || [];
    holder.innerHTML = "";
    for (const nozzle of readings) {
      const row = R.renumber(source.cloneNode(true)), product = R.master("fuel-products", nozzle.product), productName = R.value(product?.fields, "short_name", product?.name || "Product");
      row.dataset.psNozzle = nozzle.id; row.dataset.psTank = nozzle.tank;
      row.querySelectorAll("[name]").forEach(field => { field.name = field.name.replace(/_2\[\]/, `_${nozzle.product}[]`).replace(/^(gst|vat)2\[\]/, `$1${nozzle.product}[]`); });
      const first = row.querySelector(".product_info_text > div:first-child"), labels = first?.querySelectorAll(".m_10");
      if (labels?.[0]) labels[0].textContent = `${productName}-${nozzle.tank}`;
      if (labels?.[1]?.firstChild) labels[1].firstChild.textContent = `${nozzle.pump}-${nozzle.name} `;
      const values = { noz_name: nozzle.id, pump_id: nozzle.pumpId, nozprod_id: nozzle.product, noztank_no: nozzle.tank, sale_pump: nozzle.pump, open_read: existing?.fields?.open_read ?? nozzle.opening, close_read: existing?.fields?.close_read ?? "", noz_test: existing?.fields?.test_qty ?? "0", sale_rate: existing?.rate ?? nozzle.rate, noz_emp: existing?.fields?.employee ?? nozzle.employee };
      for (const [key, value] of Object.entries(values)) R.set(row, `${key}_${nozzle.product}`, value);
      const employee = row.querySelector("select"); if (employee) employee.dataset.psRelation = "employees";
      if (nozzle.existingId && !existing) { row.dataset.psExisting = nozzle.existingId; row.querySelector('[name^="close_read"]')?.setAttribute("placeholder", "Already entered — edit below"); }
      holder.append(row);
    }
    if (!readings.length) holder.innerHTML = '<p class="m_10">Add tanks, nozzles, and pump settings before entering a meter sale.</p>';
    R.fillRelations(holder); R.initWidgets(holder); R.calculateForm(form);
  };
  R.renderStock = async (form = document.querySelector('form[data-ps-form="1"]'), offered) => {
    if (!form) return;
    const holder = form.querySelector("#tan") || form.querySelector("[data-ps-stock-holder]"); if (!holder) return;
    const source = (await R.fragment("stock")).querySelector("[data-ps-row]"); if (!source) return;
    holder.innerHTML = "";
    for (const stock of offered || state.stock || []) {
      const row = R.renumber(source.cloneNode(true)), f = stock.fields || {}, product = R.master("fuel-products", f.product);
      row.dataset.psTank = f.tank_no;
      row.querySelectorAll(".modal").forEach(modal => modal.remove());
      const label = row.querySelector(".op-bill-left > span"); if (label) label.textContent = stock.name;
      const productLabel = row.querySelector("input:not([name])[readonly]"); if (productLabel) productLabel.value = product?.name || "";
      for (const [name, value] of Object.entries(f)) R.set(row, name, value);
      R.set(row, "t_cap", f.capacity); R.set(row, "prod_rate", state.rates[f.product]?.closing || "0");
      const rate = state.rates[f.product]; R.set(row, "prodrate_vari", rate ? R.number(rate.closing) - R.number(rate.opening) : 0);
      row.querySelectorAll("[data-prodrate]").forEach(field => { field.dataset.prodrate = rate?.closing || "0"; });
      for (const field of row.querySelectorAll('[name="total_stk[]"],[name="close_stock[]"],[name="stk_variation[]"]')) field.readOnly = true;
      holder.append(row); R.calculateStockRow(row);
    }
    R.initWidgets(holder);
  };
  R.calculateStockRow = row => {
    const number = name => R.number(R.fieldValue(row, name, "0")), closing = number("open_stock") + number("receipt") - number("meter_sale"), variation = number("dip_stock") - closing;
    R.set(row, "total_stk", R.money(number("open_stock") + number("receipt"))); R.set(row, "close_stock", R.money(closing));
    R.set(row, "stk_variation", R.money(variation)); R.set(row, "vari_amnt", R.money(variation * number("prod_rate"))); R.set(row, "rate_revision", R.money(closing * number("prodrate_vari")));
  };
  R.meterDialog = async (tank, entry) => {
    const form = document.createElement("form"); R.localForm(form, "meter-sales", entry);
    form.innerHTML = `<div class="kgn-details-grids"><label>Sale Date</label><input name="insert_date" class="form-control input-sm" type="date" required value="${esc(entry?.date || state.date)}"><div id="noz1"></div><div class="text-center"><button type="submit" class="btn btn-success">Save</button></div></div>`;
    const body = R.dialog(entry ? "Edit Meter Sale" : "Nozzels", form);
    let readings = (state.nozzles || []).filter(nozzle => !tank || nozzle.tank === tank);
    if (entry) {
      const f = entry.fields, nozzleId = R.value(f, ["nozzle_id", "nozzle"]);
      readings = [{ ...(readings.find(nozzle => nozzle.id === nozzleId) || {}), id: nozzleId, product: R.value(f, "product"), pumpId: R.value(f, "pump_id"), pump: R.value(f, ["pump", "sale_pump"]), tank: R.value(f, "tank_no"), name: R.master("nozzles", nozzleId)?.name || nozzleId, rate: entry.rate, opening: R.value(f, "open_read"), employee: R.value(f, "employee") }];
    }
    await R.renderMeter(form, readings, entry); R.initWidgets(body);
  };
  R.attendanceDialog = async entry => {
    const source = await R.fragment("attendance-add"), original = source.querySelector('form[action*="attendence/save"]') || source.querySelector("form");
    const form = R.localForm(R.cleanClone(original.cloneNode(true)), "attendance", entry);
    form.querySelectorAll(".modal").forEach(modal => modal.remove());
    const date = entry?.date || state.date;
    const dateField = R.field(form, "attend_dt"); if (dateField) { dateField.name = "insert_date"; dateField.value = date; dateField.type = "date"; dateField.dataset.psDate = "1"; }
    const table = form.querySelector("table"), body = table.tBodies[0] || table.createTBody();
    let details = entry?.fields?.details || [];
    if (entry && !details.length) details = (await R.api(`/api/petrosoft/state?module=attendance-details&from=${date}&to=${date}`)).records;
    body.innerHTML = (state.masters.employees || []).filter(employee => employee.status === "active" || details.some(day => R.value(day.fields, "employee") === employee.externalId)).map((employee, index) => {
      const day = details.find(day => R.value(day.fields, ["employee", "attend_empid"]) === employee.externalId), f = day?.fields || {}, status = R.value(f, "attend_type", "P"), shift = R.value(f, "shift", (state.masters["duty-shifts"] || [])[0]?.name || "General");
      return `<tr data-ps-attendance="${esc(employee.externalId)}"><td>${index + 1}</td><td>${esc(employee.name)}</td><td>${esc(R.value(employee.fields, "designation"))}</td><td><select class="form-control input-sm" name="attend_type">${["P", "A", "P:A"].map(value => `<option${value === status ? " selected" : ""}>${value}</option>`).join("")}</select></td><td><select name="shift" class="form-control input-sm">${(state.masters["duty-shifts"] || []).map(item => `<option value="${esc(item.name)}"${item.name === shift ? " selected" : ""}>${esc(item.name)}</option>`).join("") || '<option>General</option>'}</select></td><td><input name="hours" type="number" min="0" max="24" class="form-control input-sm" value="${esc(R.value(f, "hours", "8"))}"></td><td><select name="attend_remark" class="form-control input-sm"><option${R.value(f, "attend_remark", "Paid") === "Paid" ? " selected" : ""}>Paid</option><option${R.value(f, "attend_remark") === "Unpaid" ? " selected" : ""}>Unpaid</option></select></td><td><input name="description" class="form-control input-sm" value="${esc(R.value(f, "description"))}"></td></tr>`;
    }).join("");
    form.dataset.psAttendance = "1";
    R.dialog(entry ? "View / Edit Attendance" : "Add Attendance", form); R.initWidgets(form);
  };
  R.attendanceMonth = async month => {
    const source = await R.fragment("attendance-month"), form = source.querySelector("form");
    form.dataset.psCustom = "1"; form.querySelectorAll("select").forEach(select => { select.dataset.psRelation = select.name === "emp_id" ? "employees" : "duty-shifts"; });
    const input = R.field(form, "frm_dt"); input.type = "month"; input.value = month || state.date.slice(0, 7); input.dataset.psDate = "1";
    const body = R.dialog("Month Attendance", source); R.fillRelations(body); R.initWidgets(body);
    const show = async () => {
      const selected = input.value, end = new Date(Date.UTC(Number(selected.slice(0, 4)), Number(selected.slice(5, 7)), 0)).getUTCDate();
      const data = await R.api(`/api/petrosoft/state?module=attendance-details&from=${selected}-01&to=${selected}-${end}`), target = body.querySelector("#get_output");
      const employeeId = R.fieldValue(form, "emp_id"), shifts = R.fieldValue(form, "shift");
      const employees = (data.masters.employees || []).filter(employee => (!employeeId || /all/i.test(employeeId) || employee.externalId === employeeId) && employee.status === "active");
      const days = data.records.filter(day => !shifts || /all/i.test(shifts) || R.value(day.fields, "shift") === shifts || R.master("duty-shifts", shifts)?.name === R.value(day.fields, "shift"));
      target.innerHTML = `<div class="table-responsive"><table class="table table-bordered"><thead><tr><th>Employee</th><th>Present days</th><th>Absent days</th>${Array.from({ length: end }, (_, index) => `<th>${index + 1}</th>`).join("")}</tr></thead><tbody>${employees.map(employee => {
        const list = days.filter(day => R.value(day.fields, ["employee", "attend_empid"]) === employee.externalId);
        return `<tr><td>${esc(employee.name)}</td><td>${list.filter(day => R.value(day.fields, "attend_type") === "P").length}</td><td>${list.filter(day => R.value(day.fields, "attend_type") === "A").length}</td>${Array.from({ length: end }, (_, index) => { const date = `${selected}-${String(index + 1).padStart(2, "0")}`, status = R.value(list.find(day => day.date === date)?.fields, "attend_type"); return `<td class="${status === "P" ? "bg-success" : status === "A" ? "bg-danger" : status ? "bg-warning" : ""}">${esc(status)}</td>`; }).join("")}</tr>`;
      }).join("")}</tbody></table></div>`;
    };
    form.onsubmit = event => { event.preventDefault(); show().catch(error => R.notice(error.message, "error")); }; await show();
  };
  R.payrollDialog = async month => {
    const source = await R.fragment("payroll-salary"), native = source.querySelector("#form_handler");
    const form = native ? R.cleanClone(native.cloneNode(true)) : document.createElement("form"); R.localForm(form, "payroll"); form.dataset.psPayroll = "1";
    form.querySelectorAll(".modal").forEach(modal => modal.remove());
    const selected = month || state.date.slice(0, 7);
    form.innerHTML = `<div class="row"><div class="col-md-4"><label>Filter Month</label><input class="form-control input-sm" type="month" name="month" required value="${esc(selected)}"></div><div class="col-md-4"><label>Salary Date</label><input class="form-control input-sm" type="date" name="payment_date" required value="${esc(state.date)}"></div><div class="col-md-4"><label>&nbsp;</label><div><button type="button" class="btn btn-primary" data-ps-payroll-preview>Submit</button></div></div></div><div data-ps-payroll-data class="mt-15"></div>`;
    const body = R.dialog("Pay Roll Salary Summary", form); R.initWidgets(body);
    const preview = async () => {
      const data = await R.api("/api/petrosoft/action", { module: "payroll", operation: "preview-payroll", fields: { month: R.fieldValue(form, "month") } });
      form.dataset.psPayrollRows = JSON.stringify(data.rows);
      const headings = ["Employee", "Designation", "Duty Salary", "Total Duties", "Total Salary", "PF", "ESI", "Benefits", "Penalty", "Incentive", "Loan", "Advance", "Business Shortage", "Net Salary", "Payment Mode", "Attendance"];
      const editable = ["duty_rate", "total_duties", "total_salary", "pf", "esi", "benefits", "penalty", "incentive", "loan", "advance", "shortage", "net_salary"];
      form.querySelector("[data-ps-payroll-data]").innerHTML = `<div class="table-responsive"><table class="table table-bordered ps-payroll-table"><thead><tr>${headings.map(heading => `<th>${heading}</th>`).join("")}</tr></thead><tbody>${data.rows.map(row => `<tr data-ps-payroll-employee="${esc(row.employee)}"><td>${esc(row.employee_name)}</td><td>${esc(R.master("employees", row.employee)?.fields?.designation || "")}</td>${editable.map(key => `<td><input name="${key}" class="form-control input-sm" inputmode="decimal" value="${esc(row[key] ?? (key === "total_salary" ? row.duty_salary : "0"))}"${["net_salary", "total_duties"].includes(key) ? " readonly" : ""} aria-label="${esc(key.replace(/_/g, " "))}"></td>`).join("")}<td><select name="pay_mode" class="form-control input-sm"><option>Cash</option><option>Bank</option></select><select name="pay_bank" data-ps-relation="business-parties" class="form-control input-sm" hidden><option value="">Choose Bank</option></select></td><td><button type="button" class="btn btn-primary" data-ps-payroll-attendance="${esc(row.employee)}"><i class="icon-eye"></i></button></td></tr>`).join("")}</tbody></table></div><div class="text-center mt-15"><label><input type="checkbox" name="pay_now" value="yes"> Pay salaries now</label> <button class="btn btn-primary" type="submit">Submit</button><p class="mt-15">Total Salary: <b data-ps-payroll-total>${R.format(data.total)}</b></p></div>`;
      R.fillRelations(form); R.initWidgets(form); form.querySelectorAll("[data-ps-payroll-employee]").forEach(R.calculatePayrollRow);
    };
    form.querySelector("[data-ps-payroll-preview]").onclick = () => preview().catch(error => R.notice(error.message, "error")); await preview();
  };
  R.calculatePayrollRow = row => {
    const get = name => R.number(R.fieldValue(row, name, "0")), net = get("total_salary") + get("benefits") + get("incentive") - get("pf") - get("esi") - get("penalty") - get("loan") - get("advance") - get("shortage");
    R.set(row, "net_salary", R.money(Math.max(0, net)));
    const form = row.closest("form"), total = Array.from(form.querySelectorAll('[name="net_salary"]')).reduce((sum, input) => sum + R.number(input.value), 0); form.querySelector("[data-ps-payroll-total]").textContent = R.format(total);
  };
  R.payrollDetail = entry => {
    const rows = entry.fields.rows || [], html = `<div class="table-responsive"><table class="table table-bordered"><thead><tr><th>Employee</th><th>Total Salary</th><th>Benefits</th><th>Deductions</th><th>Net Salary</th><th>Payment Mode</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.employee_name)}</td><td>${R.format(row.total_salary || row.duty_salary)}</td><td>${R.format(row.benefits)}</td><td>${R.format(["pf", "esi", "it", "loan", "advance", "penalty", "shortage"].reduce((sum, key) => sum + R.number(row[key]), 0))}</td><td>${R.format(row.net_salary)}</td><td>${esc(row.pay_mode)}</td></tr>`).join("")}</tbody></table></div><p>Total: ${R.format(entry.amount)} — ${entry.fields.paid ? "Paid" : "Generated"}</p>`;
    const body = R.dialog("Pay Roll", html, `${entry.fields.paid ? "" : '<button class="btn btn-primary" data-ps-pay-salary type="button">Pay Salary</button>'} <button class="btn btn-default" data-ps-print type="button">Print</button>`);
    body.parentElement.querySelector("[data-ps-print]").onclick = () => window.print();
    const pay = body.parentElement.querySelector("[data-ps-pay-salary]"); if (pay) pay.onclick = () => R.confirm("Post the salary payments for this payroll?", async () => { const result = await R.api("/api/petrosoft/action", { module: "payroll", operation: "pay", id: entry.id, fields: { month: entry.fields.month, rows, payment_date: state.date } }); R.notice(result.message); await R.refresh(); });
  };
  R.specialEdit = async entry => {
    if (entry.fields?.parent_id) { const result = await R.api(`/api/petrosoft/state?id=${encodeURIComponent(entry.fields.parent_id)}`); await R.editRecord(result.entry); return true; }
    if (entry.module === "meter-sales") { await R.meterDialog(R.value(entry.fields, "tank_no"), entry); return true; }
    if (entry.module === "opening-stock") {
      const form = R.localForm(document.createElement("form"), "opening-stock", entry); form.innerHTML = `<label>End Date/Time</label><input type="date" name="insert_date" class="form-control" required value="${esc(entry.date)}"><div id="tan"></div><div class="text-center"><button class="btn btn-success" type="submit">Save</button></div>`;
      R.dialog("Edit Day Opening Stock", form); await R.renderStock(form, [{ ...entry, fields: { ...entry.fields, capacity: R.master("tanks", R.value(entry.fields, "tank_no"))?.fields?.tank_cap } }]); return true;
    }
    if (entry.module === "attendance") { await R.attendanceDialog(entry); return true; }
    if (entry.module === "payroll") { R.payrollDetail(entry); return true; }
    const fragments = { employees: "employees-edit", customers: "customers-edit", "swipe-machines": "swipe-machines-edit", tanks: "tanks-edit", roles: "roles-edit" };
    if (fragments[entry.module]) {
      const source = await R.fragment(fragments[entry.module]), original = source.querySelector("form"), form = R.localForm(R.cleanClone(original.cloneNode(true)), entry.module, entry);
      form.querySelectorAll(".modal").forEach(modal => modal.remove());
      R.fillRelations(form); R.populate(form, entry); R.dialog(`Edit ${context.module.title}`, form); R.initWidgets(form); return true;
    }
    return false;
  };
  R.auxDialog = async (module, parent) => {
    try {
      const mappings = { nozzles: "nozzles-add", vehicles: "customer-vehicles", "pump-incentives": "pump-incentives", permissions: "roles-view", roles: "roles-add" };
      if (mappings[module]) {
        const source = await R.fragment(mappings[module]), original = source.querySelector("form"), inModal = original?.closest(".modal");
        const form = inModal ? R.cleanClone(original.cloneNode(true)) : original;
        source.querySelectorAll(".navbar,.sidebar,.footer,.page-header,.modal").forEach(node => node.remove());
        if (inModal) source.prepend(form);
        R.localForm(form, module === "permissions" ? "roles" : module, module === "permissions" ? parent : undefined);
        form.dataset.psAuxType = module; form.dataset.psParent = parent?.externalId || ""; form.dataset.psParentId = parent?.id || "";
        if (module === "nozzles") { R.set(form, "tank_no", R.value(parent.fields, "tank_no")); R.set(form, "prod_id", R.value(parent.fields, ["product", "pro_name"])); R.childTable(source.querySelector("table"), (state.masters.nozzles || []).filter(entry => R.value(entry.fields, "tank_no") === R.value(parent.fields, "tank_no"))); }
        if (module === "vehicles") R.childTable(source.querySelector("table"), (state.masters.vehicles || []).filter(entry => R.value(entry.fields, "customer_id") === parent.externalId));
        if (module === "pump-incentives") { R.set(form, "pump_id", parent.externalId); R.childTable(source.querySelector("table"), (state.masters["pump-incentives"] || []).filter(entry => R.value(entry.fields, "pump_id") === parent.externalId)); }
        if (module === "permissions") {
          R.populate(form, parent);
          const permissions = parent.fields.permissions || [], all = permissions.includes("*");
          for (const input of form.querySelectorAll('[name="page_id[]"]')) { const permission = context.rolePages?.[input.value]; input.dataset.psPageId = input.value; input.value = permission || ""; input.checked = Boolean(permission && (all || permissions.includes(permission) || permissions.includes(permission.split(":")[0]))); }
          form.querySelector('[name="check_all"]')?.addEventListener("change", event => form.querySelectorAll('[name="page_id[]"]').forEach(input => { if (input.value) input.checked = event.target.checked; }));
        }
        R.dialog(parent ? `${parent.name} — ${module === "permissions" ? "Role Permissions" : module.replace(/-/g, " ")}` : "Add Role", source); R.fillRelations(source); R.initWidgets(source); return;
      }
      let fields = "", title = module.replace(/-/g, " ");
      const input = (name, label, value = "0", type = "text") => `<div class="col-md-4"><label>${esc(label)}</label><input type="${type}" name="${name}" class="form-control input-sm" value="${esc(value)}"></div>`;
      if (module === "employee-benefits") {
        fields = input("pf", "Provident Fund", R.value(parent.fields, "pf", "0")) + input("esi", "ESI", R.value(parent.fields, "esi", "0")) + input("it", "Income Tax", R.value(parent.fields, "it", "0"));
        const earnings = (state.masters["employee-benefits"] || []).filter(entry => R.value(entry.fields, "employee") === parent.externalId);
        fields += `<div class="col-md-12 mt-15"><table class="table table-bordered"><thead><tr><th>Earnings</th><th>Amount</th><th></th></tr></thead><tbody>${(earnings.length ? earnings : [{ name: "Basic", amount: parent.fields.salary || "0" }]).map(entry => `<tr data-ps-row><td><input name="earning[]" class="form-control" value="${esc(entry.name)}"></td><td><input name="earn_amt[]" class="form-control" value="${esc(entry.amount)}"></td><td><button type="button" data-ps-add-row class="btn btn-primary">+</button></td></tr>`).join("")}</tbody></table></div><input name="employee" type="hidden" value="${esc(parent.externalId)}">`;
      } else if (module === "customer-interest") fields = `<input name="customer_id" type="hidden" value="${esc(parent.externalId)}">` + input("int_percent", "Yearly Interest Rate (%)", R.value(parent.fields, "int_percent", "0")) + input("grace_days", "Grace Days", R.value(parent.fields, "grace_days", "0")) + '<div class="col-md-4"><label>Interest Type</label><select name="int_type" class="form-control"><option>Fixed</option><option>Compound</option></select></div>';
      else if (module === "expiry-renewals") fields = `<input name="item_id" type="hidden" value="${esc(R.value(parent.fields, "item_id", parent.externalId))}"><input name="cat_id" type="hidden" value="${esc(R.value(parent.fields, "cat_id"))}">` + input("item_number", "Unique Number", R.value(parent.fields, "item_number", parent.name)) + input("exp_date", "Expiry Date", state.date, "date") + input("alert_days", "Days Before Alert", R.value(parent.fields, "alert_days", "30")) + input("descp", "Note", "");
      else if (module === "assignment-returns") fields = `<input name="assignment_id" type="hidden" value="${esc(parent.id)}"><input name="date" type="hidden" value="${esc(state.date)}">` + input("sold_qty", "Sold", R.value(parent.fields, "sold_qty", "0")) + input("returned_qty", "Returned", R.value(parent.fields, "returned_qty", "0"));
      else if (module === "parameters") fields = input("cCode", "CODE", "") + input("cValue", "VALUE", "") + input("cDesc", "DESCRIPTION", "");
      else if (module === "bowsers") fields = input("b_name", "Bowser Name", "") + input("b_vehicle", "Vehicle No", "") + input("capacity", "Capacity", "0") + '<div class="col-md-4"><label>Product</label><select name="product" data-ps-relation="fuel-products" class="form-control"></select></div>';
      else { if (parent) R.detail(parent); return; }
      const form = R.localForm(document.createElement("form"), module); form.innerHTML = `<div class="row">${fields}</div><div class="text-center mt-15"><button type="submit" class="btn btn-success">Save</button></div>`;
      R.dialog(parent ? `${parent.name} — ${title}` : title, form); R.fillRelations(form); R.initWidgets(form);
    } catch (error) { R.notice(error.message, "error"); }
  };
})();
(function () {
  "use strict";
  const R = window.PetrosoftRuntime;
  if (!R) return;
  const { state, context, esc } = R;
  const readRow = row => Object.fromEntries(Array.from(row.querySelectorAll("input[name],select[name],textarea[name]")).filter(input => !["button", "submit", "file"].includes(input.type) && (!["radio", "checkbox"].includes(input.type) || input.checked)).map(input => [input.name.replace(/\[\]$/, ""), input.value]));
  R.specialSubmit = async (form, schema, fields) => {
    const module = form.dataset.psModule || context.module.id;
    const send = async (body, operation = "save") => {
      const result = await R.api("/api/petrosoft/action", { module, operation, formIndex: schema?.index, id: form.dataset.psEdit || undefined, fields: body });
      R.notice(result.message); if (form.dataset.psAux || form.dataset.psEdit) R.closeDialog(); await R.refresh();
      if (result.documents?.[0]) await R.openDocument({ id: result.documents[0].id }); return result;
    };
    if (form.dataset.psAttendance) {
      const rows = Array.from(form.querySelectorAll("[data-ps-attendance]")).map(row => ({ employee: row.dataset.psAttendance, ...readRow(row) }));
      await send({ insert_date: R.fieldValue(form, "insert_date"), shift: R.value(context.query, "shift", "S-1"), rows }); return true;
    }
    if (form.dataset.psPayroll) {
      const expected = JSON.parse(form.dataset.psPayrollRows || "[]");
      if (!expected.length) throw new Error("Choose a month and preview salaries first.");
      const rows = Array.from(form.querySelectorAll("[data-ps-payroll-employee]")).map(row => ({ ...expected.find(item => item.employee === row.dataset.psPayrollEmployee), ...readRow(row), employee: row.dataset.psPayrollEmployee }));
      await send({ month: R.fieldValue(form, "month"), payment_date: R.fieldValue(form, "payment_date"), pay_now: R.field(form, "pay_now")?.checked ? "yes" : "no", rows }); return true;
    }
    if (module === "opening-stock") { await send({ insert_date: R.fieldValue(form, "insert_date"), rows: R.formRows(form).map(readRow) }); return true; }
    if (form.dataset.psAuxType === "nozzles") { await send({ rows: R.array(fields, "nozzle").filter(Boolean).map(name => ({ noz_name: name, nozzle_name: name, tank_no: R.fieldValue(form, "tank_no"), product: R.fieldValue(form, "prod_id") })) }); return true; }
    if (form.dataset.psAuxType === "vehicles") { await send({ rows: R.array(fields, "vehicle_no").filter(Boolean).map((name, index) => ({ vehicle_no: name, vehicle_place: R.array(fields, "vehicle_place")[index] || "", vehicle_type: R.array(fields, "vehicle_type")[index] || "", customer_id: form.dataset.psParent })) }); return true; }
    if (form.dataset.psAuxType === "pump-incentives") { await send({ rows: R.array(fields, "benchmark").filter(Boolean).map((value, index) => ({ benchmark: value, name: R.array(fields, "benchmark_name")[index] || value, rate: R.array(fields, "rate")[index] || "0", pump_id: form.dataset.psParent })) }); return true; }
    if (form.dataset.psAuxType === "permissions") { const previous = R.record(form.dataset.psEdit)?.fields?.permissions || [], all = Array.from(form.querySelectorAll('[name="page_id[]"]')).every(input => input.checked); await send({ ...fields, page_ids: Array.from(form.querySelectorAll('[name="page_id[]"]:checked')).map(input => input.dataset.psPageId), permissions: all && previous.includes("*") ? ["*"] : [...new Set(R.array(fields, "page_id").filter(Boolean))] }); return true; }
    if (context.module.id === "vendor-transactions" && schema?.action.includes("addVendor")) {
      const result = await R.api("/api/petrosoft/action", { module: "vendors", fields: { rows: R.array(fields, "vendor_name").filter(Boolean).map(name => ({ ven_comp: name, join_dt: state.date, vend_type: "Other" })) } });
      R.notice(result.message); R.closeDialog(); await R.refresh(); return true;
    }
    if (module === "parameters" && schema?.fields?.length === 0) { await R.auxDialog("parameters"); return true; }
    if (schema?.action.includes("save_recovery") && context.module.id === "day-assignments") {
      const employee = R.value(fields, ["recv_emp1", "rec_emp1"]), assignments = state.records.filter(entry => R.value(entry.fields, ["emp_assign", "employee"]) === employee);
      const body = R.dialog("Assignment Recovery", `<table class="table table-bordered"><thead><tr><th>Product</th><th>Assigned</th><th>Sold</th><th>Returned</th><th></th></tr></thead><tbody>${assignments.map(entry => `<tr><td>${esc(entry.fields.product_name || entry.name)}</td><td>${R.format(entry.quantity)}</td><td>${R.format(entry.fields.sold_qty || 0)}</td><td>${R.format(entry.fields.returned_qty || 0)}</td><td><button type="button" class="btn btn-primary" data-ps-assignment="${esc(entry.id)}">Recover</button></td></tr>`).join("")}</tbody></table>`);
      body.querySelectorAll("[data-ps-assignment]").forEach(button => { button.onclick = () => R.auxDialog("assignment-returns", R.record(button.dataset.psAssignment)); }); return true;
    }
    return false;
  };
  R.reportView = report => {
    const content = `<div class="ps-print-heading"><h3>${esc(context.station)}</h3><p>${esc(state.settings.company_address1 || "")}<br>${esc(state.settings.company_address2 || "")}</p></div><p>Date Range : ${esc(report.from)} To ${esc(report.to)}</p>${report.sections.map(section => `<h4 class="text-center">${esc(section.title)}</h4><div class="table-responsive"><table class="ps-report-table"><thead><tr>${section.columns.map(column => `<th scope="col">${esc(column)}</th>`).join("")}</tr></thead><tbody>${section.cells?.length ? section.cells.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${section.columns.length}" class="text-center">No records found</td></tr>`}</tbody></table></div>`).join("")}`;
    return R.dialog(report.title, content, '<button class="btn btn-default" data-ps-report-excel type="button">Excel</button> <button class="btn btn-default" data-ps-report-pdf type="button">PDF</button> <button class="btn btn-primary" data-ps-print type="button">Print</button>');
  };
  R.openReport = async (index, fields = {}) => {
    const report = await R.api("/api/petrosoft/report", { index, fields });
    if (report.format === "xlsx") { await R.download("/api/petrosoft/export", { index, fields, format: "xlsx" }, `${report.title}.xlsx`); return; }
    const body = R.reportView(report), footer = body.parentElement;
    footer.querySelector("[data-ps-print]").onclick = () => window.print();
    footer.querySelector("[data-ps-report-excel]").onclick = () => R.download("/api/petrosoft/export", { index, fields, format: "xlsx" }).catch(error => R.notice(error.message, "error"));
    footer.querySelector("[data-ps-report-pdf]").onclick = () => R.download("/api/petrosoft/export", { index, fields, format: "pdf" }).catch(error => R.notice(error.message, "error"));
  };
  R.openDocument = async entry => {
    const report = await R.api(`/api/petrosoft/document/${encodeURIComponent(entry.id)}?format=json`), body = R.reportView(report), footer = body.parentElement;
    footer.querySelector("[data-ps-print]").onclick = () => window.print();
    for (const [selector, format] of [["[data-ps-report-excel]", "xlsx"], ["[data-ps-report-pdf]", "pdf"]]) footer.querySelector(selector).onclick = () => {
      const link = document.createElement("a"); link.href = `/api/petrosoft/document/${encodeURIComponent(entry.id)}?format=${format}`; link.target = "_blank"; link.rel = "noopener"; document.body.append(link); link.click(); link.remove();
    };
  };
  R.importForm = async (form, schema) => {
    const input = form.querySelector('input[type="file"]'), file = input?.files?.[0]; if (!file) throw new Error("Choose a CSV or spreadsheet to import.");
    const upload = new FormData(); upload.set("file", file); upload.set("module", context.module.id); upload.set("action", schema?.action || "");
    const response = await fetch("/api/petrosoft/import", { method: "POST", body: upload, credentials: "same-origin" }), preview = await response.json(); if (!response.ok) throw new Error(preview.error || "Unable to read this file.");
    const columns = Object.keys(preview.rows[0] || {}).filter(key => !key.startsWith("_"));
    const body = R.dialog("Import Preview", `<p>${preview.total} rows from ${esc(file.name)}</p>${preview.errors.length ? `<div class="alert alert-danger">${preview.errors.map(error => `Row ${error.row}: ${esc(error.message)}`).join("<br>")}</div>` : ""}<div class="table-responsive"><table class="table table-bordered"><thead><tr>${columns.map(column => `<th>${esc(column)}</th>`).join("")}</tr></thead><tbody>${preview.rows.slice(0, 25).map(row => `<tr>${columns.map(column => `<td>${esc(row[column])}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p>Showing ${Math.min(25, preview.total)} of ${preview.total} rows.</p><div class="text-right"><button type="button" class="btn btn-default" data-ps-close>Cancel</button> <button type="button" class="btn btn-primary" data-ps-commit-import${preview.errors.length ? " disabled" : ""}>Import ${preview.total} rows</button></div>`);
    body.querySelector("[data-ps-commit-import]").onclick = async event => {
      event.target.disabled = true;
      try { const result = await R.api("/api/petrosoft/import", { module: preview.module, rows: preview.rows, formIndex: preview.formIndex }); R.closeDialog(); R.notice(result.message); await R.refresh(); }
      catch (error) { event.target.disabled = false; R.notice(error.message, "error"); }
    };
  };
  R.saveProfile = async form => {
    const fields = R.readForm(form), file = form.querySelector('input[type="file"]')?.files?.[0];
    if (file) { const data = new FormData(); data.set("file", file); data.set("module", "profile"); const response = await fetch("/api/petrosoft/attachment", { method: "POST", body: data }), uploaded = await response.json(); if (!response.ok) throw new Error(uploaded.error); fields.attachment_id = uploaded.id; }
    const result = await R.api("/api/petrosoft/profile", fields); R.notice(result.message);
    if (R.$?.fn.modal) R.$(form.closest(".modal")).modal("hide");
    await R.loadProfile?.();
  };
  R.calculateSettlement = form => {
    const summary = state.summary || {}, number = name => R.number(R.fieldValue(form, name, "0")), sums = name => Array.from(form.querySelectorAll(`[name="${name}[]"]`)).reduce((sum, field) => sum + R.number(field.value), 0);
    const net = R.number(state.cashClosing) - R.number(state.cashOpening), incoming = sums("received_amt") + sums("receivedDealerAmt"), outgoing = sums("hand_amt") + sums("toDealer") + number("pettycash"), closing = number("opencash") + net + incoming - outgoing;
    for (const [name, value] of Object.entries({ finialbankamt: net, totinflw: incoming, total_outflow: outgoing, closecash: closing, finalamt: closing, handcash: summary.hand_cash || 0 })) R.set(form, name, R.money(value));
  };
  R.calculateDenominations = field => {
    const area = field.closest(".modal") || field.form || document, denominations = state.masters.denominations || [];
    let total = 0;
    for (const input of area.querySelectorAll('[name^="denom_"]')) {
      const id = input.name.replace(/^denom_/, "").replace(/\[\]$/, ""), record = denominations.find(entry => entry.externalId === id || R.value(entry.fields, "d_val") === id), value = R.number(R.value(record?.fields, ["d_val", "denomination"], id)), amount = R.number(input.value) * value;
      total += amount; const cell = input.closest("tr")?.querySelector("td:last-child"); if (cell && !cell.contains(input)) cell.textContent = R.format(amount);
    }
    const target = area.querySelector('[id*="total"],[data-ps-denomination-total]'); if (target) target.textContent = R.format(total);
    area.dataset.psDenominationTotal = total;
  };
  R.providerDialog = (entry, action) => {
    const type = action?.includes("cancel") ? "Cancel" : "Generate";
    R.dialog(`${type} ${context.module.id === "eway-bills" ? "E-way Bill" : "E-Invoice"}`, `<p>${esc(entry?.name || "")}</p><p>Configure the NIC or authorized GSP credentials in this installation to ${type.toLowerCase()} government documents.</p><p>Local invoices and reports are available from the records above.</p>`);
  };
  const aliases = {
    "app/sale/add": "meter-sales", "app/product/add": "lubricant-sales", "app/swipe/add": "swipes", "app/credit/add": "credit-sales", "app/expenses/add": "expenses", "app/recovery/add/recovery": "recoveries", "app/settlement/add": "settlements", "app/daily_sale_rate/add": "daily-rates", "attendanceemp": "attendance", "app/master/box/sheet": "shift-sheet", "app/dashboard": "dashboard",
  };
  R.routeAction = async href => {
    const route = href.replace(/^\/petrosoft\/?/, "").replace(/\?.*$/, "").replace(/\/$/, "").toLowerCase();
    if (/app\/roles\/add$/.test(route)) { await R.auxDialog("roles"); return true; }
    if (/app\/attendence\/attendance_add$/.test(route)) { await R.attendanceDialog(); return true; }
    if (/app\/attendence\/view_month_atten$/.test(route)) { await R.attendanceMonth(); return true; }
    if (/app\/payroll\/salary_summary$/.test(route)) { await R.payrollDialog(); return true; }
    if (/biometric|push_new_employees/.test(route)) { R.dialog("Biometric Device", "<p>Configure the biometric device connection for this installation before pushing employees.</p>"); return true; }
    if (aliases[route]) { const module = state.modules.find(module => module.id === aliases[route]); if (module) { R.destination(`/petrosoft/${module.path}`); return true; } }
    return false;
  };
  R.shiftEntryDialog = async moduleId => {
    const module = state.modules.find(module => module.id === moduleId); if (!module) throw new Error("Your role cannot open this module.");
    const response = await fetch(`/api/petrosoft/view/${module.path}`), html = await response.text(), page = new DOMParser().parseFromString(html, "text/html"), settings = JSON.parse(page.querySelector("#ps-context")?.textContent || "{}");
    const schema = settings.module?.forms.find(form => form.operation === "save"), original = schema && page.querySelector(`form[data-ps-form="${schema.index}"]`);
    if (!original) throw new Error("Open this module from the menu to enter records.");
    const form = R.cleanClone(original.cloneNode(true)); R.localForm(form, moduleId); form.querySelectorAll(".modal").forEach(modal => modal.remove());
    form.dataset.psSchema = JSON.stringify(schema); R.set(form, "insert_date", state.date); R.set(form, "pur_date", state.date);
    R.dialog(module.title, form); R.fillRelations(form); R.initWidgets(form);
    if (moduleId === "meter-sales") await R.renderMeter(form); if (moduleId === "opening-stock") await R.renderStock(form);
  };
  document.addEventListener("input", event => {
    const field = event.target, row = field.closest("[data-ps-row]");
    if (row?.dataset.psTank && row.closest("form")?.querySelector("#tan")) R.calculateStockRow(row);
    const salary = field.closest("[data-ps-payroll-employee]"); if (salary) { if (field.name === "duty_rate") R.set(salary, "total_salary", R.money(R.number(field.value) * R.number(R.fieldValue(salary, "total_duties")))); R.calculatePayrollRow(salary); }
  });
  document.addEventListener("change", async event => {
    const field = event.target;
    try {
      if (field.closest("[data-ps-payroll-employee]") && field.name === "pay_mode") { const bank = R.field(field.closest("tr"), "pay_bank"); bank.hidden = field.value !== "Bank"; bank.parentElement.querySelector(".ts-wrapper")?.classList.toggle("ps-hidden", field.value !== "Bank"); }
      const row = field.closest("[data-ps-row]");
      if (row?.dataset.psTank && ["dip_reading[]", "dip_stock[]"].includes(field.name) && field.value) {
        const result = await R.api("/api/petrosoft/calculate", { module: field.form.dataset.psModule || context.module.id, tank_no: row.dataset.psTank, ...(field.name === "dip_reading[]" ? { dip: field.value } : { stock: field.value }) });
        R.set(row, field.name === "dip_reading[]" ? "dip_stock" : "dip_reading", field.name === "dip_reading[]" ? result.stock : result.dip); R.calculateStockRow(row);
      }
      if (field.dataset.psOnchange?.includes("attach_type") || field.name.replace(/\[.*$/, "") === "attach_type") { const area = R.rowFor(field), value = field.value; R.toggleFields(area, ["attach_vendor"], value === "Vendor"); R.toggleFields(area, ["attach_bank"], value === "Bank"); }
      if (field.form?.dataset.psOperation === "report" && field.type === "checkbox" && /all|group/.test(field.name + field.id)) { const group = field.closest(".stock-check,.op-billing-check,.checkbox-wrap,.form-group") || field.form; group.querySelectorAll('input[type="checkbox"]').forEach(input => { if (input !== field) input.checked = field.checked; }); }
    } catch (error) { R.notice(error.message, "error"); }
  });
  document.addEventListener("click", async event => {
    const control = event.target.closest("button,a,input[type=button],input[type=submit]"); if (!control) return;
    const handler = control.dataset.psOnclick || "", id = control.id;
    try {
      if (id === "bulk_delete" || handler.includes("delete_all")) {
        event.preventDefault(); const ids = Array.from(document.querySelectorAll("[data-ps-select]:checked")).map(input => input.dataset.psSelect); if (!ids.length) throw new Error("Select entries to delete.");
        R.confirm(`Delete ${ids.length} selected entries?`, async () => { const result = await R.api("/api/petrosoft/action", { module: context.module.id, operation: "delete", ids }); R.notice(result.message); await R.refresh(); }); return;
      }
      if (id === "generate_bill") {
        event.preventDefault(); const ids = Array.from(document.querySelectorAll("[data-ps-select]:checked")).map(input => input.dataset.psSelect);
        const result = await R.api("/api/petrosoft/action", { module: "sale-invoices", operation: "generate", ids, fields: { invoice_date: state.date } }); R.notice(result.message); await R.refresh(); if (result.documents?.[0]) await R.openDocument({ id: result.documents[0].id }); return;
      }
      if (id === "showModal" && context.module.id === "settlements") { event.preventDefault(); const form = control.closest("form"); R.calculateSettlement(form); R.confirm(`Closing cash: ${R.format(R.fieldValue(form, "closecash"))}. Save this day settlement?`, () => R.submitForm(form)); return; }
      if (/showUploadmodel|showUploadmodel|showBulkUploadModel/.test(handler)) { event.preventDefault(); const modal = document.querySelector('.modal form[data-ps-operation="import"]')?.closest(".modal"); if (modal && R.$?.fn.modal) R.$(modal).modal("show"); return; }
      if (handler.includes("get_densityFileds") || handler.includes("showDensityform")) {
        event.preventDefault(); const row = control.closest("[data-ps-row]") || control.closest("form"), form = document.createElement("form"); form.dataset.psCustom = "1";
        form.innerHTML = `<div class="row"><div class="col-md-4"><label>Temperature</label><input class="form-control" type="number" name="temperature" step="any" required></div><div class="col-md-4"><label>Hydro Meter Reading</label><input class="form-control" type="number" name="hydrometer" step="any" required></div><div class="col-md-4"><label>Density (15 °C)</label><input class="form-control" name="density" readonly></div></div><div class="text-center mt-15"><button class="btn btn-success" type="submit">Ok</button></div>`;
        R.dialog("Density Test", form); form.onsubmit = async e => { e.preventDefault(); try { const result = await R.api("/api/petrosoft/calculate", { operation: "density", ...R.readForm(form) }); R.set(row, "temp_read", R.fieldValue(form, "temperature")); R.set(row, "hydrometer_read", R.fieldValue(form, "hydrometer")); R.set(row, "density", result.density); R.closeDialog(); } catch (error) { R.notice(error.message, "error"); } }; return;
      }
      if (handler.includes("get_nozzels")) { event.preventDefault(); await R.meterDialog(control.closest("[data-ps-row]")?.dataset.psTank); return; }
      if (handler.includes("openearninmodal")) { event.preventDefault(); const form = control.closest("form"), row = R.rowFor(control), field = row?.querySelector('[name^="salary"]'); const body = R.dialog("Earnings", `<label>Basic</label><input class="form-control" data-ps-earning-amount value="${esc(field?.value || "0")}"><div class="text-center mt-15"><button class="btn btn-success" type="button" data-ps-earning-save>Save changes</button></div>`); body.querySelector("[data-ps-earning-save]").onclick = () => { if (field) field.value = body.querySelector("[data-ps-earning-amount]").value; R.closeDialog(); R.calculateForm(form); }; return; }
      if (id === "link" && context.module.id === "shift-sheet") { event.preventDefault(); const body = R.dialog("Shift Sheet Entry", `<div class="row">${["meter-sales", "lubricant-sales", "swipes", "credit-sales", "expenses", "recoveries", "employee-recoveries", "opening-stock", "settlements"].map(id => state.modules.find(module => module.id === id)).filter(Boolean).map(module => `<div class="col-md-4 mt-15"><button class="btn btn-primary btn-block" type="button" data-ps-shift-module="${module.id}">${esc(module.title)}</button></div>`).join("")}</div>`); body.querySelectorAll("[data-ps-shift-module]").forEach(button => { button.onclick = () => R.shiftEntryDialog(button.dataset.psShiftModule).catch(error => R.notice(error.message, "error")); }); return; }
      if (handler.includes("goToDaySheetReport")) { event.preventDefault(); await R.openReport(30, { from: state.date, to: state.date }); return; }
      if (handler.includes("printPageArea")) { event.preventDefault(); window.print(); return; }
      if (/send_sms|sendMail|send_email|send_whatsapp|confirmPush/.test(handler) || control.closest("a")?.getAttribute("href")?.startsWith("mailto:")) { event.preventDefault(); R.dialog("Communication Settings", "<p>Configure the email, SMS, WhatsApp, or device connection for this installation before sending.</p>"); return; }
      if (handler.includes("resetModal")) { control.closest("form")?.reset(); return; }
      if (handler.includes("clearFile")) { event.preventDefault(); const modal = control.closest(".modal"), file = modal?.querySelector('input[type="file"]'); if (file) file.value = ""; return; }
      if (control.dataset.psPayrollAttendance) { event.preventDefault(); await R.attendanceMonth(control.closest("form")?.querySelector('[name="month"]')?.value); return; }
      if (control.dataset.psAddBowser) { event.preventDefault(); await R.auxDialog("bowsers"); }
    } catch (error) { R.notice(error.message, "error"); }
  });
})();
