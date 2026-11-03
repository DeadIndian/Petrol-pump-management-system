(function () {
  "use strict";
  const R = window.PetrosoftRuntime;
  if (!R) return;
  const { context, state, esc, $, destination } = R;
  R.module = context.module;
  R.today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  R.number = value => { const parsed = Number(String(value ?? "0").replace(/[,₹]/g, "")); return Number.isFinite(parsed) ? parsed : 0; };
  R.money = value => R.number(value).toFixed(2);
  R.format = value => new Intl.NumberFormat(state.settings?.num_fmt || "en-IN", { maximumFractionDigits: 2 }).format(R.number(value));
  R.value = (fields, names, fallback = "") => {
    for (const name of Array.isArray(names) ? names : [names]) {
      const found = fields?.[name] ?? fields?.[`${name}[]`];
      if (found !== undefined && found !== null && found !== "") return String(Array.isArray(found) ? found[0] ?? "" : found);
    }
    return fallback;
  };
  R.master = (module, id) => (state.masters?.[module] || []).find(record => record.externalId === String(id).split("|")[0] || record.id === id || record.name === id);
  R.balance = (type, id, measure = "balance") => R.number(state.balances?.[type]?.[String(id).split("|")[0]]?.[measure] || 0);
  R.base = module => module.startsWith("bowser-") ? module === "bowser-sales" ? "meter-sales" : module.slice(7) : module;
  R.can = (module, operation = "view") => {
    const permissions = context.actor?.permissions || [], parent = context.parents?.[module];
    return permissions.includes("*") || permissions.includes(module) || permissions.includes(`${module}:${operation}`) || Boolean(parent && (permissions.includes(parent) || permissions.includes(`${parent}:${operation}`)));
  };
  R.field = (area, name) => Array.from(area.querySelectorAll("input[name],select[name],textarea[name]")).find(element => element.name === name || element.name === `${name}[]` || element.name.replace(/\[\d*\]$/, "") === name);
  R.fieldValue = (area, name, fallback = "") => {
    const field = R.field(area, name);
    if (field?.type === "radio") return Array.from(area.querySelectorAll('input[type="radio"]')).find(input => input.name === field.name && input.checked)?.value ?? fallback;
    return field?.value ?? fallback;
  };
  R.optionValue = (select, value) => {
    if (select.dataset.psOptionFormat !== "party") return value ?? "";
    const id = String(value ?? "").split("|")[0];
    return Array.from(select.options).find(option => option.value === String(value ?? "") || option.value.split("|")[0] === id)?.value ?? value ?? "";
  };
  R.set = (area, name, value, notify = false) => {
    for (const field of Array.from(area.querySelectorAll("input[name],select[name],textarea[name]")).filter(element => element.name === name || element.name === `${name}[]` || element.name.replace(/\[\d*\]$/, "") === name)) {
      const offered = field.tagName === "SELECT" ? R.optionValue(field, value) : value;
      if (field.tomselect) field.tomselect.setValue(offered ?? "", !notify);
      else if (field.type === "checkbox" || field.type === "radio") field.checked = Array.isArray(value) ? value.map(String).includes(field.value) : String(value) === field.value || value === true;
      else field.value = offered ?? "";
      if (notify) field.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };
  let activeDialog = null;
  let previousFocus = null;
  R.closeDialog = () => {
    if (!activeDialog) return;
    activeDialog.querySelectorAll("select").forEach(element => element.tomselect?.destroy());
    activeDialog.remove(); activeDialog = null;
    previousFocus?.focus();
    document.body.style.overflow = "";
  };
  R.dialog = (title, content, footer = "") => {
    R.closeDialog(); previousFocus = document.activeElement;
    activeDialog = document.createElement("div"); activeDialog.className = "ps-dialog-backdrop";
    activeDialog.innerHTML = `<section class="ps-dialog" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="ps-dialog-title"><div class="ps-dialog-heading"><h2 id="ps-dialog-title">${esc(title)}</h2><button class="close" type="button" data-ps-close aria-label="Close">×</button></div><div class="ps-dialog-content"></div>${footer ? `<div class="ps-dialog-footer">${footer}</div>` : ""}</section>`;
    const body = activeDialog.querySelector(".ps-dialog-content");
    if (typeof content === "string") body.innerHTML = content; else body.append(content);
    document.body.append(activeDialog); document.body.style.overflow = "hidden";
    activeDialog.querySelector("[data-ps-close]").addEventListener("click", R.closeDialog);
    activeDialog.addEventListener("click", event => { if (event.target === activeDialog) R.closeDialog(); });
    activeDialog.addEventListener("keydown", event => {
      if (event.key === "Escape") R.closeDialog();
      if (event.key !== "Tab") return;
      const focusable = Array.from(activeDialog.querySelectorAll("a,button,input,select,textarea,[tabindex='0']")).filter(element => !element.disabled && element.offsetParent !== null);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { last?.focus(); event.preventDefault(); }
      else if (!event.shiftKey && document.activeElement === last) { first?.focus(); event.preventDefault(); }
    });
    const opened = activeDialog;
    setTimeout(() => {
      if (opened !== activeDialog) return;
      const controls = Array.from(opened.querySelectorAll("input:not([type=hidden]),button,select,textarea,a[href],[tabindex='0']")).filter(element => !element.disabled && element.offsetParent !== null);
      const initial = controls.find(element => body.contains(element)) || controls[0] || opened.querySelector('[role="dialog"]');
      initial.focus({ preventScroll: true });
    }, 0);
    return body;
  };
  R.confirm = async (message, callback) => {
    const body = R.dialog("Confirm", `<p>${esc(message)}</p><div class="text-right"><button class="btn btn-default" type="button" data-ps-cancel>Cancel</button> <button class="btn btn-danger" type="button" data-ps-confirm>Confirm</button></div>`);
    body.querySelector("[data-ps-cancel]").onclick = R.closeDialog;
    body.querySelector("[data-ps-confirm]").onclick = async () => { try { await callback(); R.closeDialog(); } catch (error) { R.notice(error.message, "error"); } };
  };
  R.fillRelations = (area = document) => {
    for (const select of area.querySelectorAll("select[data-ps-relation]")) {
      const relation = select.dataset.psRelation, selected = select.tomselect ? select.tomselect.getValue() : select.multiple ? Array.from(select.selectedOptions).map(option => option.value) : select.value;
      select.tomselect?.destroy();
      const placeholders = Array.from(select.options).filter(option => ["", "0", "all", "All"].includes(option.value)).map(option => option.outerHTML).join("");
      let records = state.masters?.[relation] || [];
      if (relation === "business-parties" && /bank/i.test(select.name) && !/partyname/.test(select.name)) records = records.filter(record => /bank/i.test(R.value(record.fields, ["p_type", "partyType"])));
      if (relation === "nozzles") { const row = select.closest("[data-ps-row]") || select.form; const tank = row && R.fieldValue(row, "tank_no"); if (tank) records = records.filter(record => R.value(record.fields, "tank_no") === tank); }
      if (relation === "vehicles") { const row = select.closest("[data-ps-row]") || select.form; const customer = row && R.fieldValue(row, "organiz"); if (customer) records = records.filter(record => R.value(record.fields, ["customer_id", "cust_id"]) === customer); }
      select.innerHTML = placeholders || `<option value="">Choose ${esc(relation.replace(/-/g, " "))}</option>`;
      for (const record of records) {
        if (record.status === "inactive" && ![].concat(selected).some(value => String(value).split("|")[0] === record.externalId) && !select.closest('[data-ps-operation="filter"],[data-ps-operation="report"]')) continue;
        let value = select.dataset.psOptionValue ? R.value(record.fields, select.dataset.psOptionValue, record.externalId) : record.externalId;
        if (select.dataset.psOptionFormat === "party") value = [record.externalId, R.value(record.fields, ["p_type", "partyType"], "Creditor"), R.value(record.fields, "subgrp_id", "3"), R.value(record.fields, "group_id", "3")].join("|");
        const option = new Option(record.name, value);
        select.add(option);
      }
      if (select.multiple) { for (const option of select.options) option.selected = [].concat(selected).map(value => R.optionValue(select, value)).includes(option.value); } else select.value = R.optionValue(select, selected);
      if (!select.value && !select.multiple) select.selectedIndex = 0;
    }
  };
  R.initWidgets = (area = document) => {
    for (const field of area.querySelectorAll("input,select,textarea")) {
      if (!field.getAttribute("aria-label") && !field.getAttribute("aria-labelledby") && field.type !== "hidden") {
        const schema = context.module.forms.flatMap(form => form.fields).find(item => item.name === field.name);
        field.setAttribute("aria-label", schema?.label || field.placeholder || field.name || "Value");
      }
      if (field.tagName === "INPUT" && /(?:^|\[)(?:insert_date|pur_date|trans_dt|join_dt|g_date|open_dt|date_input|frm_dt|from_dt|to_dt|recv_date|assigninsert_date|date|req_date|Loss_date)(?:\[\])?$/.test(field.name) && !field.dataset.psDate) {
        field.dataset.psDate = "1";
        if ($?.fn.datetimepicker) {
          $(field).datetimepicker({ format: "YYYY-MM-DD", useCurrent: false, showTodayButton: true, showClear: true, showClose: true });
          $(field).on("dp.change", () => field.dispatchEvent(new Event("change", { bubbles: true })));
        } else field.type = "date";
      }
      if (field.tagName === "SELECT" && !field.tomselect && (field.dataset.psRelation || field.classList.contains("tom")) && window.TomSelect) {
        new window.TomSelect(field, { create: false, maxOptions: 300, dropdownParent: "body", plugins: field.multiple ? ["remove_button"] : [], allowEmptyOption: true, render: { no_results: () => '<div class="no-results">No matching entries</div>' } });
      }
      if (field.tagName === "INPUT" && /qty|qnty|quantity|amount|_amt|rate|price|cost|salary|cash|read|discount|shortage|denom|_val/.test(field.name) && !/date|type|name|id|bill|no$/.test(field.name)) field.inputMode = "decimal";
    }
  };
  document.addEventListener("click", event => {
    const menu = event.target.closest(".navigation-main li > a");
    if (menu?.parentElement.querySelector(":scope > ul")) {
      event.preventDefault(); const parent = menu.parentElement, list = parent.querySelector(":scope > ul");
      parent.classList.toggle("active"); list.style.display = parent.classList.contains("active") ? "block" : "none";
    }
    if (event.target.closest(".sidebar-main-toggle,.sidebar-mobile-main-toggle,.sidebar-mobile-secondary-toggle")) {
      event.preventDefault(); document.body.classList.toggle(innerWidth < 769 ? "ps-sidebar-open" : "sidebar-xs");
    }
    if (event.target.closest("[data-ps-close]")) R.closeDialog();
  });
  for (const list of document.querySelectorAll(".navigation-main li > ul")) {
    list.style.display = "none";
    list.parentElement.classList.add("has-ul");
  }
  for (const link of document.querySelectorAll(".sidebar a[href]")) {
    const pathname = link.getAttribute("href").replace(/^\/petrosoft\/?/, "").toLowerCase();
    const module = state.modules?.find(module => module.path.toLowerCase() === pathname);
    if (module?.id === context.module.id) { link.parentElement.classList.add("active"); for (let group = link.parentElement.parentElement; group && !group.classList.contains("navigation-main"); group = group.parentElement?.closest("ul")) { group.style.display = "block"; group.parentElement.classList.add("active"); } }
    if (pathname && pathname !== "#" && !module && /^(?:Dashboard|LiquidAdd|AddLubprods)/i.test(pathname)) link.parentElement.hidden = true;
  }
  const search = document.getElementById("globalSearch"), results = document.getElementById("searchResults");
  if (search && results) {
    search.addEventListener("input", () => {
      const query = search.value.trim().toLowerCase(); results.innerHTML = "";
      if (!query) { results.style.display = "none"; return; }
      const matches = (state.modules || []).filter(module => `${module.title} ${module.path} ${module.id}`.toLowerCase().includes(query));
      results.innerHTML = matches.length ? matches.map(module => `<a href="/petrosoft/${esc(module.path)}" class="result-item">${esc(module.title)}</a>`).join("") : '<div class="result-item">No matching modules</div>';
      results.style.display = "block";
    });
    search.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); const link = results.querySelector("a"); if (link) destination(link.getAttribute("href")); } if (event.key === "Escape") results.style.display = "none"; });
    document.addEventListener("click", event => { if (!event.target.closest(".modern-search-container,#searchResults")) results.style.display = "none"; });
  }
  document.addEventListener("keydown", event => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const ids = { d: "dashboard", m: "meter-sales", c: "credit-sales", r: "recoveries", e: "expenses", s: "swipes", l: "lubricant-sales" };
    const target = state.modules?.find(module => module.id === ids[event.key.toLowerCase()]);
    if (target) { event.preventDefault(); destination(`/petrosoft/${target.path}`); }
  });
})();
