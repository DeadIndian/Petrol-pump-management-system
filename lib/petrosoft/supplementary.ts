import type { ModuleSchema } from "./catalog";

export const supplementaryParents: Record<string, string> = {
  nozzles: "tanks", vehicles: "customers", "customer-discounts": "customers", "customer-interest": "customers",
  "swipe-settlements": "swipe-machines", "employee-benefits": "employees", "employee-loans": "employees",
  "employee-payments": "employees", overtime: "attendance", "attendance-details": "attendance",
  "payroll-details": "payroll", "expiry-categories": "expiry-items", "expiry-renewals": "expiry-items",
  calibration: "tanks", "statement-records": "statements", "brs-statements": "brs-generation",
  "vrs-statements": "vrs-generation", bowsers: "bowser-sales", "bowser-nozzles": "bowser-sales",
  "loyalty-transactions": "loyalty-dashboard", "tanker-receiving": "fuel-purchases", "assignment-returns": "day-assignments",
  "pump-incentives": "pump-settings",
};

const master = new Set(["nozzles", "vehicles", "customer-discounts", "customer-interest", "employee-benefits", "employee-loans", "expiry-categories", "expiry-renewals", "calibration", "bowsers", "bowser-nozzles", "pump-incentives"]);
export const supplementaryModules: ModuleSchema[] = Object.entries(supplementaryParents).map(([id, parent]) => ({
  id, path: `local/${id}`, title: id.split("-").map(word => word[0].toUpperCase() + word.slice(1)).join(" "),
  kind: master.has(id) ? "master" : "transaction", forms: [], tables: [], parent,
}));
