(function () {
  "use strict";
  const R = window.PetrosoftRuntime;
  if (!R) return;
  const { state, context, esc, $ } = R;
  const moduleId = context.module.id;
  const charts = new Map();
  const text = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  const html = (id, value) => { const element = document.getElementById(id); if (element) element.innerHTML = value; };
  const number = R.number;
  const sum = (rows, key) => rows.reduce((total, row) => total + number(row[key]), 0);
  const total = (rows, predicate) => rows.filter(predicate).reduce((value, row) => value + number(row.amount), 0);
  const currency = value => `${state.settings.currency || "₹"} ${R.format(value)}`;
  const chartOptions = {
    chart: { fontFamily: "Roboto, Arial, sans-serif", toolbar: { show: false }, animations: { enabled: !matchMedia("(prefers-reduced-motion: reduce)").matches } },
    colors: ["#2f80ed", "#27ae60", "#f2994a", "#9b51e0", "#eb5757", "#56ccf2"],
    dataLabels: { enabled: false }, stroke: { width: 2, curve: "smooth" },
    grid: { borderColor: "#e5e7eb" }, legend: { position: "bottom" },
    noData: { text: "No data available" }, yaxis: { labels: { formatter: value => R.format(value) } },
    tooltip: { y: { formatter: value => R.format(value) } },
  };
  R.drawChart = async (id, options) => {
    const target = document.getElementById(id);
    if (!target || !window.ApexCharts) return;
    charts.get(id)?.destroy();
    const instance = new window.ApexCharts(target, { ...chartOptions, ...options, chart: { ...chartOptions.chart, height: 270, ...options.chart } });
    charts.set(id, instance); await instance.render();
  };
  const simpleTable = (headers, rows) => `<div class="table-responsive"><table class="table table-bordered table-condensed"><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}" class="text-center">No data available</td></tr>`}</tbody></table></div>`;
  const setChartView = (control, graph, data) => {
    if (!control) return;
    const apply = () => { const isGraph = control.value === "graph"; if (graph) graph.hidden = !isGraph; if (data) data.hidden = isGraph; if (isGraph) window.dispatchEvent(new Event("resize")); };
    control.addEventListener("change", apply); apply();
  };

  R.loadProfile = async () => {
    const profile = await R.api("/api/petrosoft/profile");
    state.profile = profile;
    for (const element of document.querySelectorAll(".ps-profile-name,[data-ps-profile-name]")) element.textContent = profile.fullName || context.actor.fullName;
    const form = document.querySelector('[data-ps-operation="profile"]');
    if (form) {
      R.set(form, "user_log", context.actor.id);
      R.set(form, "delete_image", "0");
      for (const input of form.querySelectorAll('input[type="file"]')) input.value = "";
    }
    if (profile.attachment_id) for (const image of document.querySelectorAll(".ps-profile-image,[data-ps-profile-image]")) image.src = `/api/petrosoft/attachment/${encodeURIComponent(profile.attachment_id)}`;
  };

  function defaults() {
    const beginning = `${state.date.slice(0, 7)}-01`;
    for (const input of document.querySelectorAll('[data-ps-setting]')) input.value = state.settings[input.dataset.psSetting] || "";
    for (const form of document.querySelectorAll("form[data-ps-form]")) {
      const operation = form.dataset.psOperation;
      const allowed = operation === "save" || operation === "import" ? R.can(moduleId, context.module.kind === "settings" ? "edit" : "create") : operation === "report" ? R.can("reports", `report-${form.dataset.psForm}`) : true;
      if (!allowed) { form.hidden = true; continue; }
      for (const input of form.querySelectorAll("input[name],textarea[name]")) {
        const name = input.name.replace(/\[.*$/, "");
        if (input.type === "password") { input.value = ""; continue; }
        if (operation === "profile") continue;
        if (/^(?:frm_dt|from_dt|search_frm_dt|lubfrm_dt)$/.test(name)) input.value = moduleId === "payroll" ? state.date.slice(0, 7) : beginning;
        else if (/^(?:to_dt|search_to_dt)$/.test(name)) input.value = state.date;
        else if (/^(?:insert_date|pur_date|trans_dt|join_dt|g_date|open_dt|date_input|recv_date|assigninsert_date|req_date|date|Loss_date)$/.test(name) && input.type !== "hidden") input.value = state.date;
      }
      if (operation === "report") for (const input of form.querySelectorAll('input[type="checkbox"]')) if (/all/i.test(input.name + input.id)) input.checked = true;
    }
    const dashboardDate = document.getElementById("file-date");
    if (dashboardDate) { dashboardDate.value = state.date; dashboardDate.type = "date"; dashboardDate.setAttribute("aria-label", "Select Date"); }
    if (moduleId === "payroll") { const input = document.querySelector('input[name="frm_dt"]'); if (input) { input.type = "month"; input.dataset.psDate = "1"; } }
    if (["organization", "settings", "print-templates"].includes(moduleId)) {
      for (const form of document.querySelectorAll('form[data-ps-operation="save"]')) {
        R.populate(form, state.settings);
        if (moduleId === "settings") {
          const ids = state.settings.feature_ids || state.settings["page_id[]"] || [];
          for (const input of form.querySelectorAll('[name="page_id[]"]')) input.checked = [].concat(ids).map(String).includes(input.value);
        }
      }
    }
    if (moduleId === "loyalty-points") for (const input of document.querySelectorAll('[name="start_qty"]')) input.value = state.settings.start_qty || state.settings.ponits_start || "0";
    for (const select of document.querySelectorAll('select[name="shift"]')) if (!select.value && select.options.length > 1) select.value = select.options[1].value;
  }

  function rateFields() {
    if (!["daily-rates", "shift-sheet"].includes(moduleId)) return;
    const form = document.querySelector('form[data-ps-form="1"]');
    if (!form) return;
    const products = (state.masters["fuel-products"] || []).filter(product => product.status === "active");
    R.renderRateProducts(form, products);
    for (const product of products) {
      const id = product.externalId, rate = state.rates[id];
      R.set(form, `oid_ratre[${id}]`, rate?.closing || "0");
      R.set(form, `new_rate[${id}]`, rate?.date === state.date ? rate.opening : rate?.closing || "0");
      R.set(form, `cls_rate[${id}]`, rate?.closing || "0");
      R.set(form, `var_amt[${id}]`, rate ? number(rate.closing) - number(rate.opening) : "0");
    }
    if (moduleId === "shift-sheet") {
      const ready = (state.masters["fuel-products"] || []).filter(record => record.status === "active").every(product => state.rates[product.externalId]?.date === state.date);
      const link = document.getElementById("linkbtn"), save = document.getElementById("savebtn"), entries = document.getElementById("rateentry");
      if (link) link.style.display = ready ? "" : "none";
      if (save) save.style.display = ready ? "none" : "";
      if (entries) entries.style.display = ready ? "none" : "";
    }
  }

  function settlementFields() {
    if (moduleId !== "settlements") return;
    const form = document.querySelector('form[data-ps-form="1"]'); if (!form) return;
    R.set(form, "opencash", R.money(state.cashOpening));
    R.set(form, "finialbankamt", R.money(number(state.cashClosing) - number(state.cashOpening)));
    R.calculateSettlement(form);
    for (const selector of ["#inflowTrnxdiv", "#totinflwdiv"]) { const element = form.querySelector(selector); if (element) element.style.display = R.field(form, "anyinflw")?.checked ? "" : "none"; }
    const handover = R.fieldValue(form, "handover_type", "Cash");
    const vendor = form.querySelector("#vendor_out"), parties = form.querySelector("#outTrnxdiv");
    if (vendor) vendor.style.display = /vendor/i.test(handover) ? "" : "none";
    if (parties) parties.style.display = /vendor/i.test(handover) ? "none" : "";
  }

  async function dashboard() {
    if (moduleId !== "dashboard") return;
    const summary = state.summary || {}, recent = state.recent || [], trends = state.trends || [], monthly = state.monthlyTrends || [], recovery = state.recoveryTrends || [], stocks = state.dashboardStock || state.stock || [];
    const productSelect = document.getElementById("sel2");
    if (productSelect) {
      productSelect.tomselect?.destroy(); productSelect.removeAttribute("data-ps-relation");
      productSelect.innerHTML = [["Liquids", "fuel-products", ""], ["Lubricants", "lubricants", "l_"]].map(([label, type, prefix]) => `<optgroup label="${label}">${(state.masters[type] || []).filter(entry => entry.status === "active").map(entry => `<option value="${esc(prefix + entry.externalId)}">${esc(entry.name)}</option>`).join("")}</optgroup>`).join("");
      productSelect.value = state.dashboardProduct || ""; R.initWidgets(productSelect.parentElement);
    }
    const stockMonth = document.getElementById("month_picker_current_stock"); if (stockMonth) stockMonth.value = state.stockMonth || state.date.slice(0, 7);
    const recoverySelect = document.getElementById("credit_recov_select");
    if (recoverySelect) { recoverySelect.dataset.psRelation = "customers"; R.fillRelations(recoverySelect.parentElement); recoverySelect.value = state.filters.credit_customer || "0"; R.initWidgets(recoverySelect.parentElement); }
    const sale = number(summary.meter_sale) + number(summary.lubricant_sale), purchase = number(summary.fuel_purchase) + number(summary.lubricant_purchase);
    const vendorCollection = total(recent, row => R.base(row.module) === "recoveries" && /vendor/i.test(R.value(row.fields, "re_type")));
    const bankCollection = total(recent, row => R.base(row.module) === "recoveries" && /bank|upi|cheque/i.test(R.value(row.fields, "re_type"))) + number(summary.swipe);
    const values = { day_sale: currency(sale), liq_sale: R.format(summary.meter_sale), lub_sale: R.format(summary.lubricant_sale), sale_disc_off: R.format(summary.discount), day_allcash: currency(sale), day_cash: R.format(summary.hand_cash), day_credit: R.format(summary.credit), day_bank: R.format(bankCollection), day_vendor: R.format(vendorCollection), day_discount: R.format(summary.discount), day_purchase: currency(purchase), liq_pur: R.format(summary.fuel_purchase), lub_pur: R.format(summary.lubricant_purchase), day_open_cash: currency(state.cashOpening) };
    Object.entries(values).forEach(([id, value]) => text(id, value));
    const date = new Date(`${state.date}T12:00:00+05:30`), label = document.querySelector(".greeting-date");
    if (label) label.textContent = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(date);
    const products = (state.masters["fuel-products"] || []).filter(product => product.status === "active").map(product => {
      const list = recent.filter(row => R.base(row.module) === "meter-sales" && R.value(row.fields, "product") === product.externalId);
      return [product.name, R.format(list.reduce((qty, row) => qty + number(row.quantity), 0)), R.format(total(list, () => true))];
    });
    html("prd-data", products.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join("")}</tr>`).join(""));
    const bankRows = (state.bankFlow || []).map(row => [row.name, R.format(row.debit), R.format(row.credit)]);
    html("bank_transactions_list", simpleTable(["Bank", "Debit", "Credit"], bankRows));
    const summaryRows = [["Meter Sale", summary.meter_sale], ["Lubricant Sale", summary.lubricant_sale], ["Recovery", summary.recovery], ["Cash In", summary.cash_in], ["Credit Sale", summary.credit], ["Swipe", summary.swipe], ["Discount", summary.discount], ["Expenses", summary.expenses], ["Hand Cash", summary.hand_cash], ["Opening Cash", state.cashOpening], ["Closing Cash", state.cashClosing]].map(([label, value]) => [label, R.format(value)]);
    html("overall_summary", summaryRows.map(row => `<tr><td>${esc(row[0])}</td><td class="text-right">${esc(row[1])}</td></tr>`).join(""));
    const monthLabel = date => new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
    const categories = trends.map(row => monthLabel(row.date)), monthlyCategories = monthly.map(row => monthLabel(row.date));
    html("tbl_data1", simpleTable(["Month", "Sale Qty", "Purchase Qty"], monthly.map(row => [monthLabel(row.date), R.format(row.sale), R.format(row.purchase)])));
    html("tbl_data2", simpleTable(["Bank", "Debit", "Credit"], bankRows));
    html("tbl_data3", simpleTable(["Tank", "Opening Stock", "Receipt", "Meter Sale", "Closing Stock", "Variation"], stocks.map(stock => [stock.name, R.format(stock.fields.open_stock), R.format(stock.fields.receipt), R.format(stock.fields.meter_sale), R.format(stock.fields.close_stock), R.format(stock.fields.stk_variation)])));
    html("monthly_recovery_data", simpleTable(["Month", "Credit", "Recovery"], recovery.map(row => [monthLabel(row.date), R.format(row.credit), R.format(number(row.recovery) + number(row.bank_recovery))])));
    const creditAlerts = (state.masters.customers || []).filter(customer => number(customer.fields.credit_limit) > 0 && R.balance("customer", customer.externalId) > number(customer.fields.credit_limit));
    html("creditlimit_custs", creditAlerts.map(customer => `<tr><td>${esc(customer.name)}</td><td>${esc(R.value(customer.fields, "phone_no"))}</td><td>${R.format(R.balance("customer", customer.externalId))}</td></tr>`).join(""));
    const tasks = [
      R.drawChart("day_summary_chart", { chart: { type: "bar", height: 285 }, series: [{ name: "Amount", data: summaryRows.slice(0, 9).map(row => number(String(row[1]).replace(/,/g, ""))) }], xaxis: { categories: summaryRows.slice(0, 9).map(row => row[0]) } }),
      R.drawChart("m_sale_chart", { chart: { type: "area" }, series: [{ name: "Sales", data: monthly.map(row => number(row.sale)) }], xaxis: { categories: monthlyCategories } }),
      R.drawChart("m_pur_chart", { chart: { type: "area" }, series: [{ name: "Purchase", data: monthly.map(row => number(row.purchase)) }], xaxis: { categories: monthlyCategories } }),
      R.drawChart("actualvssale", { chart: { type: "line" }, series: [{ name: "Meter Sale", data: trends.map(row => number(row.meter_sale)) }, { name: "Credit + Swipe + Cash", data: trends.map(row => number(row.credit) + number(row.swipe) + number(row.hand_cash)) }], xaxis: { categories } }),
      ...["stock_chart", "stock_variation"].map(id => R.drawChart(id, { chart: { type: "line" }, series: stocks.map(stock => ({ name: stock.name, data: (state.stockTrends || []).filter(row => R.value(row.fields, "tank_no") === R.value(stock.fields, "tank_no")).map(row => ({ x: row.date, y: number(R.value(row.fields, id === "stock_chart" ? ["dip_stock", "close_stock"] : "stk_variation")) })) })), xaxis: { type: "datetime" } })),
      R.drawChart("monthly_recovery", { chart: { type: "bar" }, series: [{ name: "Credit", data: recovery.map(row => number(row.credit)) }, { name: "Recovery", data: recovery.map(row => number(row.recovery) + number(row.bank_recovery)) }], xaxis: { categories: recovery.map(row => monthLabel(row.date)) } }),
      R.drawChart("day_sale_flow_pie", { chart: { type: "donut" }, labels: ["Cash", "Credit", "Bank", "Vendor", "Discount"], series: [Math.max(0, number(summary.hand_cash)), number(summary.credit), bankCollection, vendorCollection, number(summary.discount)] }),
      R.drawChart("day_purchase_pie", { chart: { type: "donut" }, labels: ["Fuel", "Lubricants"], series: [number(summary.fuel_purchase), number(summary.lubricant_purchase)] }),
      R.drawChart("bank_transactions_pie", { chart: { type: "donut" }, labels: bankRows.map(row => row[0]), series: (state.bankFlow || []).map(row => Math.max(0, number(row.debit))) }),
    ];
    await Promise.allSettled(tasks);
    await dashboardLedger(); dashboardViews();
  }

  async function dashboardLedger() {
    const select = document.getElementById("cr_dt_select"), type = document.getElementById("cr_dt_type")?.value || "bank";
    if (!select) return;
    const previous = select.tomselect ? select.tomselect.getValue() : select.value;
    select.tomselect?.destroy();
    const records = type === "vendor" ? state.masters.vendors || [] : (state.masters["business-parties"] || []).filter(party => /bank/i.test(R.value(party.fields, "p_type")));
    select.innerHTML = '<option value="">Select</option>' + records.map(entry => `<option value="${esc(entry.externalId)}">${esc(entry.name)}</option>`).join("");
    select.value = previous; R.initWidgets(select.parentElement);
    const balance = state.balances[type]?.[select.value];
    const rows = balance ? [["Debit", balance.debit], ["Credit", balance.credit], ["Balance", balance.balance]] : [];
    html("cd_data", simpleTable(["", "Amount"], rows.map(([label, value]) => [label, R.format(value)])));
    await R.drawChart("cr_dt_trans", { chart: { type: "bar" }, series: [{ name: "Amount", data: rows.map(row => number(row[1])) }], xaxis: { categories: rows.map(row => row[0]) } });
  }

  function loyalty() {
    if (moduleId !== "loyalty-dashboard") return;
    const data = state.loyalty || {}, values = [data.members || 0, R.format(data.earned), R.format(data.redeemed), R.format(data.balance)];
    document.querySelectorAll(".metric-value").forEach((element, index) => { element.textContent = values[index]; });
    const tbody = document.querySelector(".loyalty-shell table tbody");
    if (tbody) tbody.innerHTML = (data.topCustomers || []).length ? data.topCustomers.map((row, index) => `<tr><td>${index + 1}</td><td>${esc(row.name)}</td><td>${esc(row.tier)}</td><td>${R.format(row.spent)}</td><td>${R.format(row.points)}</td></tr>`).join("") : '<tr><td colspan="5" class="text-center">No customer activity found for this month.</td></tr>';
  }

  let generation = 0;
  R.refresh = async filters => {
    const current = ++generation;
    if (filters) {
      const normalized = { ...filters };
      if (moduleId === "payroll" && /^\d{4}-\d{2}$/.test(normalized.frm_dt || "")) { normalized.from = `${normalized.frm_dt}-01`; normalized.to = `${normalized.frm_dt}-${new Date(Date.UTC(Number(normalized.frm_dt.slice(0, 4)), Number(normalized.frm_dt.slice(5, 7)), 0)).getUTCDate()}`; delete normalized.frm_dt; }
      state.filters = normalized;
    }
    const params = new URLSearchParams({ module: moduleId, date: state.date || R.today });
    for (const [key, value] of Object.entries(state.filters || {})) if (value !== "" && value !== undefined && value !== null) params.set(key, Array.isArray(value) ? value.join(",") : value);
    const data = await R.api(`/api/petrosoft/state?${params}`);
    if (current !== generation) return;
    Object.assign(state, data);
    R.fillRelations(); R.refreshPurchaseTanks?.(); R.initWidgets();
    rateFields(); settlementFields();
    if (moduleId === "meter-sales") await R.renderMeter();
    if (moduleId === "bowser-sales") R.renderBowser();
    if (moduleId === "opening-stock") await R.renderStock();
    R.renderTables();
    for (const form of document.querySelectorAll('form[data-ps-operation="save"]')) R.calculateForm(form);
    if (moduleId === "interest") await R.initLoan(document.querySelector('form[data-ps-operation="save"]'));
    await dashboard(); loyalty();
    document.body.dataset.psReady = "true";
    document.dispatchEvent(new CustomEvent("petrosoft:ready", { detail: { module: moduleId } }));
  };
  R.formDateChanged = async date => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    state.date = date; await R.refresh();
  };

  function dashboardViews() {
    if (moduleId !== "dashboard") return;
    const monthlyView = document.getElementById("sel3")?.value || "graph", monthly = document.getElementById("sel1")?.value || "m_sale_chart";
    for (const id of ["m_sale_chart", "m_pur_chart", "actualvssale", "tbl_data1"]) { const element = document.getElementById(id); if (element) element.hidden = monthlyView === "graph" ? id !== monthly : id !== "tbl_data1"; }
    const stockView = document.getElementById("sel6")?.value || "graph", stock = document.getElementById("sel5")?.value === "stock_variation" ? "stock_variation" : "stock_chart";
    for (const id of ["stock_chart", "stock_variation", "tbl_data3"]) { const element = document.getElementById(id); if (element) element.hidden = stockView === "graph" ? id !== stock : id !== "tbl_data3"; }
    window.dispatchEvent(new Event("resize"));
  }
  const chartViews = { sel8: ["day_summary_chart", "day_summary_data"], cr_dt_view: ["cr_dt_trans", "cd_data"], sel9: ["monthly_recovery", "monthly_recovery_data"] };
  Object.entries(chartViews).forEach(([id, [graph, data]]) => setChartView(document.getElementById(id), document.getElementById(graph), document.getElementById(data)));
  document.addEventListener("change", async event => {
    const field = event.target;
    try {
      if (field.id === "file-date") await R.formDateChanged(field.value);
      if (["cr_dt_type", "cr_dt_select"].includes(field.id)) await dashboardLedger();
      if (["sel1", "sel3", "sel5", "sel6"].includes(field.id)) dashboardViews();
      if (["sel2", "credit_recov_select", "month_picker_current_stock"].includes(field.id)) { const key = { sel2: "dashboard_product", credit_recov_select: "credit_customer", month_picker_current_stock: "stock_month" }[field.id]; await R.refresh({ ...state.filters, [key]: field.value }); }
      if (field.name === "anyinflw" || field.name === "handover_type") settlementFields();
      if (/^(?:inflwtype|outtype)\[\]$/.test(field.name)) {
        const row = R.rowFor(field), target = R.field(row, field.name.startsWith("in") ? "received" : "handed");
        if (target) {
          target.tomselect?.destroy();
          const type = field.value;
          target.innerHTML = '<option value="">Choose Type</option>' + (state.masters["business-parties"] || []).filter(entry => !type || R.value(entry.fields, "p_type") === type).map(entry => `<option value="${esc(entry.externalId)}">${esc(entry.name)}</option>`).join("");
          target.removeAttribute("data-ps-relation"); R.initWidgets(row);
        }
      }
      if (field.name === "Payment" || field.name === "anypayments") { const form = field.form; R.toggleFields(form, ["payment_amnt", "payment_bank"], field.checked || field.value === "yes"); }
      if (/^(?:new_rate|cls_rate)\[\w+\]$/.test(field.name)) { const id = field.name.match(/\[(\w+)\]/)[1]; R.set(field.form, `var_amt[${id}]`, R.money(number(R.fieldValue(field.form, `cls_rate[${id}]`)) - number(R.fieldValue(field.form, `new_rate[${id}]`)))); }
      if (field.name === "shift" && moduleId === "organization") { const active = document.getElementById("shiftdiv"); if (active) active.style.display = field.value === "yes" ? "" : "none"; }
    } catch (error) { R.notice(error.message, "error"); }
  });
  document.addEventListener("input", event => {
    const input = event.target;
    if (/searchGuestCust/.test(input.dataset.psOnkeyup || "")) {
      const row = R.rowFor(input), target = row?.querySelector(".dropdown-results"); if (!target) return;
      const query = input.value.toLowerCase().trim(), matches = query ? (state.masters.guests || []).filter(guest => `${guest.name} ${R.value(guest.fields, ["g_number", "g_mobileno"] )}`.toLowerCase().includes(query)).slice(0, 20) : [];
      target.innerHTML = matches.map(guest => `<button class="ps-guest-result" type="button" data-ps-guest="${esc(guest.externalId)}">${esc(guest.name)} — ${esc(R.value(guest.fields, ["g_number", "g_mobileno"]))}</button>`).join(""); target.style.display = matches.length ? "block" : "none";
    }
  });
  document.addEventListener("click", async event => {
    const control = event.target.closest("button,a,input[type=button],input[type=checkbox]"); if (!control) return;
    const handler = control.dataset.psOnclick || "";
    try {
      if (/closeNotice/.test(handler)) { event.preventDefault(); document.getElementById("noticePop")?.setAttribute("hidden", ""); }
      if (control.id === "copyopenread" || control.id === "fieldcopy") { event.preventDefault(); const form = control.closest("form"); for (const product of state.masters["fuel-products"] || []) R.set(form, `cls_rate[${product.externalId}]`, R.fieldValue(form, `new_rate[${product.externalId}]`)); R.calculateForm(form); }
      if (control.dataset.psGuest) {
        event.preventDefault(); const guest = R.master("guests", control.dataset.psGuest), row = R.rowFor(control); R.set(row, "guest_cust", guest.externalId); R.set(row, "guest_id", guest.externalId); R.set(row, "bal_points", R.balance("loyalty", guest.externalId, "quantity"));
        const input = row.querySelector('[id^="cust_search"]'); if (input) input.value = `${guest.name} — ${R.value(guest.fields, "g_number")}`;
        row.querySelector(".dropdown-results").style.display = "none"; const balance = row.querySelector('[id^="crddue"]'); if (balance) balance.textContent = `Points : ${R.format(R.balance("loyalty", guest.externalId, "quantity"))}`;
      }
      if (/send_feedback/.test(handler)) { event.preventDefault(); const form = control.closest("form"); R.set(form, "rating", handler.match(/\d+/)?.[0]); if (form.reportValidity()) await R.submitForm(form); }
      if (/searchIndentData/.test(handler)) {
        event.preventDefault(); const query = document.getElementById("indentSearchInput").value.trim();
        ["indent_empty", "indent_notfound", "indent_result"].forEach(id => { const element = document.getElementById(id); if (element) element.style.display = "none"; });
        if (!query) { document.getElementById("indent_empty").style.display = "block"; return; }
        const result = await R.api(`/api/petrosoft/state?module=credit-sales&from=1900-01-01&to=${state.date}&search=${encodeURIComponent(query)}`);
        const rows = result.records.filter(row => R.value(row.fields, ["indent_no", "ind_no"]) === query);
        if (!rows.length) { document.getElementById("indent_notfound").style.display = "block"; return; }
        html("indent_tbody", rows.map(row => `<tr><td>${esc(row.fields.organization_name)}</td><td>${esc(row.fields.product_name)}</td><td>${R.format(row.rate)}</td><td>${R.format(row.quantity)}</td><td>${R.format(row.amount)}</td></tr>`).join("")); text("indent_grand", currency(total(rows, () => true))); document.getElementById("indent_result").style.display = "block";
      }
      if (/tot_amt/.test(handler) && moduleId === "settlements") { event.preventDefault(); const modal = control.closest(".modal"); R.set(document.querySelector('form[data-ps-form="1"]'), "pettycash", modal.dataset.psDenominationTotal || "0"); $(modal).modal("hide"); R.calculateSettlement(document.querySelector('form[data-ps-form="1"]')); }
      if (moduleId === "settlements" && /showUploadmodel/.test(handler)) { event.preventDefault(); const modal = document.getElementById("uploadswipeModal1"); if (modal && $?.fn.modal) $(modal).modal("show"); }
      if (/vendor_(?:in_)?append|balamountflow|append_inflow/.test(handler)) { event.preventDefault(); R.addRow(control); }
      if (control.id === "btnResetBillSeq") { event.preventDefault(); R.confirm("Reset the next credit bill number to 1? Existing bill numbers will be retained.", async () => { const result = await R.api("/api/petrosoft/action", { module: "settings", operation: "reset-bills", fields: {} }); R.notice(result.message); }); }
    } catch (error) { R.notice(error.message, "error"); }
  });

  async function initialize() {
    state.date = R.value(context.query, ["date", "insert_date"], R.today);
    state.filters = {};
    const data = await R.api(`/api/petrosoft/state?module=${encodeURIComponent(moduleId)}&date=${state.date}`);
    Object.assign(state, data); defaults(); R.fillRelations(); R.initWidgets();
    const bankTypes = document.getElementById("credit_recov_select"); if (bankTypes) { bankTypes.dataset.psRelation = "customers"; R.fillRelations(bankTypes.parentElement); R.initWidgets(bankTypes.parentElement); }
    await R.refresh();
    await R.loadProfile();
    const editId = context.query.id; if (editId) { const entry = R.record(editId) || (await R.api(`/api/petrosoft/state?id=${encodeURIComponent(editId)}`)).entry; if (entry) await R.editRecord(entry); }
  }
  initialize().catch(error => { R.notice(error.message, "error"); document.body.dataset.psReady = "error"; });
})();
