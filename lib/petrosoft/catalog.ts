import source from "./catalog.json";
import { supplementaryModules } from "./supplementary";

export type PetrosoftFields = Record<string, unknown>;
export interface FieldSchema {
  name: string; id: string; label: string; type: string; required: boolean;
  multiple: boolean; relation: string | null; options: { value: string; label: string }[];
}
export interface FormSchema {
  index: number; action: string; fields: FieldSchema[]; title: string; operation: string;
}
export interface TableSchema { id: string; headers: string[]; columns: (string | null)[]; exports?: string[]; scrollY?: string; lengths?: number[]; enhanced?: boolean }
export interface ModuleSchema {
  id: string; path: string; title: string; kind: string; forms: FormSchema[]; tables: TableSchema[];
}
export const modules = source as ModuleSchema[];
export const moduleById = new Map([...modules, ...supplementaryModules].map(module => [module.id, module]));

export function normalizePath(path: string) {
  return path.replace(/^\/?(?:petrosoft\/|index\.php\/)?/i, "").replace(/^\/+|\/+$/g, "");
}

export function resolveModule(path: string): ModuleSchema | undefined {
  const normalized = normalizePath(path).toLowerCase();
  if (["", "app/dashboard", "dashboard"].includes(normalized)) return moduleById.get("dashboard");
  return modules.find(module => module.path.toLowerCase() === normalized || module.id === normalized)
    || modules.find(module => module.forms.some(form => form.action.toLowerCase() === normalized));
}

export function primaryForm(module: ModuleSchema) {
  return module.forms.find(form => ["save", "import"].includes(form.operation)
    && !/updateprofile|\/change_password|\/upload/i.test(form.action))
    || module.forms.find(form => form.operation !== "profile");
}

export function formFor(module: ModuleSchema, index?: number, action?: string) {
  return (index !== undefined ? module.forms.find(form => form.index === index) : undefined)
    || module.forms.find(form => form.action === action) || primaryForm(module);
}

export const masterIds = [...modules, ...supplementaryModules].filter(module => module.kind === "master").map(module => module.id);

export function jsonFields(value: unknown): PetrosoftFields {
  return value && typeof value === "object" && !Array.isArray(value) ? value as PetrosoftFields : {};
}

export function fieldValue(fields: PetrosoftFields, names: string | string[], fallback = ""): string {
  for (const name of Array.isArray(names) ? names : [names]) {
    const value = fields[name] ?? fields[`${name}[]`];
    if (value !== undefined && value !== null && value !== "") {
      return String(Array.isArray(value) ? value[0] ?? "" : value);
    }
  }
  return fallback;
}

export function fieldNumber(fields: PetrosoftFields, names: string | string[], fallback = 0): number {
  const value = fieldValue(fields, names, String(fallback));
  const parsed = Number(value.replace(/[,₹]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function dateValue(value: unknown, fallback?: Date): Date {
  const text = String(value || "").trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00.000Z` : text;
  const date = new Date(iso);
  if (!text || !Number.isFinite(date.getTime()) || /^\d{4}-\d{2}-\d{2}$/.test(text) && date.toISOString().slice(0, 10) !== text) {
    if (fallback) return new Date(fallback.toISOString().slice(0, 10) + "T00:00:00.000Z");
    throw new Error("Choose a valid date.");
  }
  return new Date(date.toISOString().slice(0, 10) + "T00:00:00.000Z");
}

export function today() {
  const text = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return dateValue(text);
}
