/* Local controllers for Petrosoft's original forms and widgets. */
(function () {
  "use strict";
  const context = JSON.parse(document.getElementById("ps-context")?.textContent || "{}");
  const root = window;
  const $ = root.jQuery;
  const state = { records: [], masters: {}, dashboard: {}, balances: {}, rates: {}, filters: {}, ...context };
  root.Petrosoft = state;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const destination = url => { if (window.top) window.top.location.assign(url); else location.assign(url); };
  async function api(path, body) {
    const response = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (response.status === 401 && context.screen === "application") destination("/petrosoft/login");
    if (!response.ok) throw new Error(result.error || "Please try again.");
    return result;
  }
  function notice(message, type = "success") {
    document.querySelector(".ps-notice")?.remove();
    const box = document.createElement("div"); box.className = "ps-notice"; box.dataset.type = type;
    box.setAttribute("role", type === "error" ? "alert" : "status"); box.textContent = message; document.body.append(box);
    setTimeout(() => box.remove(), 6500);
  }
  function readForm(form) {
    const data = new FormData(form), result = {};
    for (const key of new Set(data.keys())) {
      const values = data.getAll(key).filter(value => typeof value === "string");
      result[key] = key.includes("[]") || values.length > 1 ? values : values[0] ?? "";
    }
    return result;
  }
  async function auth(form) {
    const submit = form.querySelector('[type="submit"]');
    const body = { ...readForm(form), action: form.dataset.psAuth };
    form.querySelector(".ps-auth-error")?.remove();
    if (submit) submit.disabled = true;
    try { const result = await api("/api/petrosoft/auth", body); destination(result.redirect); }
    catch (error) { const box = document.createElement("div"); box.className = "ps-auth-error"; box.setAttribute("role", "alert"); box.textContent = error.message; form.prepend(box); }
    finally { if (submit) submit.disabled = false; }
  }
  document.addEventListener("submit", event => {
    const form = event.target;
    if (form.matches("[data-ps-auth]")) { event.preventDefault(); auth(form); }
  }, true);
  document.addEventListener("click", async event => {
    const link = event.target.closest("a[href]");
    if (!link) return;
    const href = link.getAttribute("href");
    if (/login\/(logout|switch_bunk)/i.test(href)) {
      event.preventDefault();
      try { const result = await api("/api/petrosoft/auth", { action: href.includes("switch") ? "switch" : "logout" }); destination(result.redirect); } catch (error) { notice(error.message, "error"); }
    } else if (href.startsWith("/petrosoft/") || href === "/petrosoft") {
      event.preventDefault();
      if (root.PetrosoftRuntime?.routeAction && await root.PetrosoftRuntime.routeAction(href, link)) return;
      destination(href);
    }
  });
  if (context.screen !== "application") return;
  // The application controllers below share these primitives and the server's catalogue.
  root.PetrosoftRuntime = { context, state, esc, api, notice, readForm, destination, $ };
})();
