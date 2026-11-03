import pages from "./pages.json";
import reports from "./reports.json";

const groups: Record<string, string> = {
  dashboard: "dashboard", "user roles": "roles", "system user": "users", "bunk user": "users",
  "fuel product purchase": "fuel-purchases", "tank&nozzels": "tanks", employee: "employees",
  "meter sale": "meter-sales", "daily wetstock": "opening-stock", "credit sales": "credit-sales", credit: "credit-sales",
  recovery: "recoveries", "credit customer": "customers", "pumps setting": "pump-settings", "create pumps": "pump-settings",
  "daily sale rate": "daily-rates", product: "lubricants", lubricant: "lubricants", "lub items": "lubricants",
  report: "reports", reports: "reports", "bunk print": "reports", swipe: "swipes", expenses: "expenses",
  "expenses catogery": "expense-types", "wetstock dump": "opening-stock", "wetstock report": "stock",
  "daily collection report": "cash-flow", "credit report": "statements", "stock variations": "stock",
  "credit limit": "credit-limits", "backup data": "backup", vendor: "vendors", "vendor transaction": "vendor-transactions",
  attendance: "attendance", "master entry": "shift-sheet", "lubs purchase": "lubricant-purchases", "lubricant stock": "lubricant-stock",
  "employee advance": "employee-recoveries", "business crd/debit transaction": "business-transactions", "business crd/debit parties": "business-parties",
  "day settlement": "settlements", "guest customer": "guests", "tanker sale": "tanker-sales", "expiry master": "expiry-items",
  "day employee sheet": "sheet-records", "cash denominations": "denominations", "emp. daycash collection": "employee-recoveries",
  "sales officer": "sales-officer", "print templates": "print-templates", "credit party e-bill": "statements", "day assignings": "day-assignments",
  "employee dutypay": "payroll", "duty workshifts": "duty-shifts", "fuel product": "fuel-products", bowser: "bowser-sales",
  "loan interest": "interest", "generate print": "sale-invoices", "petty cash": "settlements", "lfr purchase": "lfr-invoices",
  bowserlubsale: "bowser-lubricant-sales", bowserswipe: "bowser-swipes", bowsercredit: "bowser-credit-sales",
  bowserexpence: "bowser-expenses", bowserrecovery: "bowser-recoveries", "business shitfs": "business-shifts",
  "loyalty programme": "loyalty-dashboard", "audit report": "audit", "liquid stock": "fuel-minimum-stock",
  "help desk": "support", "pos settlement": "swipe-settlements", incentive: "pump-incentives", "non fuel purchase": "other-purchases",
  "credit request": "credit-requests", "overtime duty": "overtime",
};
const specific: Record<string, string> = {
  "149": "vehicles:create", "257": "vehicles:view", "258": "vehicles:edit", "406": "vehicles:delete",
  "260": "nozzles:create", "261": "nozzles:edit", "377": "nozzles:delete", "378": "nozzles:toggle",
  "235": "swipe-machines:view", "236": "swipe-machines:create", "237": "swipe-machines:view", "238": "swipe-machines:edit", "239": "swipe-machines:delete", "240": "swipe-machines:toggle",
  "214": "lubricant-sales:create", "215": "lubricant-sales:view", "216": "lubricant-sales:edit", "217": "lubricant-sales:delete", "232": "lubricant-sales:view",
  "220": "lubricants:create", "221": "lubricants:edit", "222": "lubricants:view", "223": "lubricants:delete", "328": "lubricants:toggle",
  "299": "credit-requests:view", "300": "credit-requests:edit", "301": "credit-requests:delete", "405": "credit-requests:edit",
  "270": "guest-sales:view", "271": "guest-sales:view", "272": "guest-sales:create", "273": "guest-sales:edit", "274": "guest-sales:delete", "275": "guest-sales:view", "276": "guest-sales:export",
  "327": "vehicles:view", "331": "vehicles:create", "332": "vehicles:edit", "333": "vehicles:delete",
  "323": "lubricant-loss:create", "324": "lubricant-loss:view", "325": "lubricant-loss:edit", "326": "lubricant-loss:delete",
  "329": "print-templates:view", "330": "print-templates:edit", "334": "statements:view", "335": "statements:create", "336": "statement-records:delete",
  "442": "gifts:create", "443": "gifts:edit", "444": "gifts:delete", "445": "gift-purchases:view", "446": "gift-purchases:edit",
  "447": "gift-sales:view", "448": "loyalty-dashboard:view", "449": "loyalty-tiers:view", "457": "eway-bills:view",
  "393": "sale-invoices:view", "394": "generated-invoices:view", "395": "sale-invoices:create", "396": "generated-invoices:export",
};
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
function permission(page: (typeof pages)[number]) {
  if (specific[page.page_id]) return specific[page.page_id];
  const moduleSchema = groups[page.page_module.trim().toLowerCase()];
  if (!moduleSchema) return `legacy:${page.page_id}`;
  if (moduleSchema === "reports") {
    const report = reports.find(item => normalized(item.title) === normalized(page.page_link) || normalized(item.title) === normalized(page.page_name));
    if (report) return `reports:report-${report.index}`;
  }
  const label = `${page.page_link} ${page.page_name}`.toLowerCase();
  const operation = /delete/.test(label) ? "delete" : /inact|act\/|active.*status/.test(label) ? "toggle"
    : /update|edit|change/.test(label) ? "edit" : /print|buttons|button_/.test(label) ? "export"
      : /add|create|creat_|generate|save/.test(label) ? "create" : "view";
  return `${moduleSchema}:${operation}`;
}
export const rolePages: Record<string, string> = Object.fromEntries(pages.map(page => [page.page_id, permission(page)]));
export function permissionsForPages(ids: unknown[]) {
  const permissions = [...new Set(ids.map(id => rolePages[String(id)]).filter(Boolean))];
  if (permissions.some(item => item.startsWith("reports:report-"))) permissions.push("reports:view");
  return permissions;
}
export function pagesForPermissions(permissions: string[]) {
  return Object.entries(rolePages).filter(([, permission]) => permissions.includes("*") || permissions.includes(permission) || permissions.includes(permission.split(":")[0])).map(([id]) => id);
}
