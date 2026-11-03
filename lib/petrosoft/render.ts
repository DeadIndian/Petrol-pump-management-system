import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModuleSchema } from "./catalog";

export function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>\"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character] || character));
}

export async function renderPetrosoft(template: string, context: Record<string, unknown>, stationName: string, referenceCode = "") {
  if (!/^[a-z0-9-]+$/.test(template)) throw new Error("Unknown Petrosoft view.");
  const source = await readFile(join(process.cwd(), "lib", "petrosoft", "templates", `${template}.html`), "utf8");
  const encoded = JSON.stringify(context).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return source.split("__PS_CONTEXT__").join(encoded).split("__PS_STATION__").join(escapeHtml(stationName))
    .split("__PS_REFERENCE__").join(escapeHtml(referenceCode));
}

export function publicModule(module: ModuleSchema) { return module; }

export const viewHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; form-action 'self'; base-uri 'self'",
};
