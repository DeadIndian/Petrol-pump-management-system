import { createHash } from "node:crypto";
import type { PetrosoftActor } from "./auth";
import { hasPermission } from "./auth";
import { PetrosoftError, transaction } from "./actions";
import { fieldValue, jsonFields, type PetrosoftFields } from "./catalog";
import { petrosoftDb } from "./db";
import { safeFields } from "./rules";

export const integrationTypes = ["sms", "email", "whatsapp", "biometric", "einvoice", "eway", "bpcl"] as const;
export type IntegrationType = (typeof integrationTypes)[number];
const permissions: Record<IntegrationType, string> = { sms: "customers", email: "statements", whatsapp: "customers", biometric: "employees", einvoice: "generated-invoices", eway: "eway-bills", bpcl: "reports" };
const titles: Record<IntegrationType, string> = { sms: "SMS", email: "Email", whatsapp: "WhatsApp", biometric: "Biometric Device", einvoice: "E-Invoice", eway: "E-way Bill", bpcl: "BPCL Fleet" };
export function integrationConfiguration(type: IntegrationType) {
  const prefix = `PETROSOFT_${type.toUpperCase()}`;
  return { endpoint: process.env[`${prefix}_URL`] || "", credential: process.env[`${prefix}_KEY`] || "" };
}
export function integrationStatus() {
  return integrationTypes.map(type => ({ type, title: titles[type], configured: Boolean(integrationConfiguration(type).endpoint) }));
}
export function integrationType(offered: unknown): IntegrationType {
  if (!integrationTypes.includes(offered as IntegrationType)) throw new PetrosoftError("Choose a supported service.");
  return offered as IntegrationType;
}
export async function requestIntegration(actor: PetrosoftActor, type: IntegrationType, operation: string, payload: PetrosoftFields, idempotencyKey?: string, permissionModule = permissions[type]): Promise<PetrosoftFields> {
  const required = type === "bpcl" ? "report-91" : operation === "status" || operation === "preview" ? "view" : "edit";
  if (!hasPermission(actor, permissionModule, required)) throw new PetrosoftError("Your role cannot use this service.", 403);
  const configuration = integrationConfiguration(type);
  if (!configuration.endpoint) throw new PetrosoftError(`${titles[type]} is awaiting a service connection for this installation.`, 503);
  let url: URL;
  try { url = new URL(configuration.endpoint); } catch { throw new PetrosoftError("The service connection needs a valid URL.", 503); }
  if (!["https:", "http:"].includes(url.protocol)) throw new PetrosoftError("The service connection needs an HTTP or HTTPS URL.", 503);
  const body = JSON.stringify({ version: 1, service: type, operation, station: { code: actor.workspace.referenceCode, name: actor.workspace.name }, payload });
  if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new PetrosoftError("Choose a smaller batch for the service request.", 413);
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(configuration.credential ? { Authorization: `Bearer ${configuration.credential}` } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) }, body, signal: AbortSignal.timeout(20000), redirect: "error", cache: "no-store" });
  } catch { throw new PetrosoftError(`${titles[type]} did not respond. Check the service status before trying again.`, 502); }
  let offered: unknown;
  try { offered = await response.json(); } catch { throw new PetrosoftError(`${titles[type]} returned an unreadable response. Check its service status.`, 502); }
  if (!offered || typeof offered !== "object" || Array.isArray(offered)) throw new PetrosoftError(`${titles[type]} returned an invalid response.`, 502);
  const data = jsonFields(offered);
  if (!response.ok || data.ok === false || data.error) throw new PetrosoftError(fieldValue(data, ["message", "error"], `${titles[type]} rejected this request.`).slice(0, 300), 502);
  return data;
}

export async function governmentDocument(actor: PetrosoftActor, type: "einvoice" | "eway", operation: string, id: string, input: PetrosoftFields) {
  if (!["generate", "cancel", "status"].includes(operation)) throw new PetrosoftError("Choose Generate, Cancel, or Status.");
  if (!hasPermission(actor, permissions[type], operation === "status" ? "view" : "edit")) throw new PetrosoftError("Your role cannot update government documents.", 403);
  if (!integrationConfiguration(type).endpoint) throw new PetrosoftError(`${titles[type]} is awaiting a service connection for this installation.`, 503);
  const entry = await petrosoftDb.petrosoftEntry.findFirst({ where: { id, workspaceId: actor.workspaceId, module: { in: type === "einvoice" ? ["generated-invoices"] : ["generated-invoices", "eway-bills"] }, status: { not: "void" } } });
  if (!entry) throw new PetrosoftError("Choose an invoice from this station.", 404);
  const initial = jsonFields(entry.fields), previous = jsonFields(jsonFields(initial.integrations)[type]);
  if (operation === "generate" && previous.status === "generated") throw new PetrosoftError("This document is already generated. Open its service status.", 409);
  if (operation === "cancel" && previous.status !== "generated") throw new PetrosoftError("Generate the document before cancelling it.", 409);
  if (operation === "cancel" && !fieldValue(input, "reason").trim()) throw new PetrosoftError("Enter a cancellation reason.");
  if (type === "eway" && operation === "generate" && (!fieldValue(input, "vehicle").trim() || !Number.isFinite(Number(input.distance)) || Number(input.distance) <= 0 || Number(input.distance) > 10000)) throw new PetrosoftError("Enter a vehicle number and distance between 1 and 10,000 km.");
  const payload = { invoice: { id: entry.id, number: entry.number, date: entry.date.toISOString().slice(0, 10), amount: entry.amount.toString(), fields: safeFields(initial) }, issuer: safeFields(jsonFields(actor.workspace.settings)), reference: previous.reference || "", vehicle: fieldValue(input, "vehicle"), distance: fieldValue(input, "distance"), transporter: fieldValue(input, "transporter"), reason: fieldValue(input, "reason") };
  const key = createHash("sha256").update(JSON.stringify({ type, operation, id, number: entry.number, amount: entry.amount.toString(), date: payload.invoice.date, sourceIds: initial.source_ids, reference: payload.reference, vehicle: payload.vehicle, distance: payload.distance })).digest("hex");
  if (operation !== "status") await transaction(async database => {
    const current = await database.petrosoftEntry.findUniqueOrThrow({ where: { id: entry.id } }), fields = jsonFields(current.fields), integration = jsonFields(jsonFields(fields.integrations)[type]);
    if (integration.status === "pending" && Date.now() - Date.parse(String(integration.started_at || current.updatedAt.toISOString())) < 60000) throw new PetrosoftError("A request for this document is already running. Check its status.", 409);
    if (operation === "generate" && integration.status === "generated") throw new PetrosoftError("This document has already been generated.", 409);
    if (operation === "cancel" && integration.status !== "generated") throw new PetrosoftError("Check the document status before cancelling it.", 409);
    await database.petrosoftEntry.update({ where: { id: entry.id }, data: { fields: safeFields({ ...fields, integrations: { ...jsonFields(fields.integrations), [type]: { ...integration, status: "pending", operation, idempotency_key: key, started_at: new Date().toISOString() } } }) } });
  });
  try {
    const response = await requestIntegration(actor, type, operation, payload, key);
    const reference = fieldValue(response, ["reference", "irn", "Irn", "ewayBillNo"], fieldValue(previous, "reference"));
    if (operation === "generate" && !reference) throw new PetrosoftError("The service did not return a document reference. Check its status before trying again.", 502);
    const state = operation === "cancel" ? "cancelled" : operation === "generate" ? "generated" : fieldValue(response, "status", fieldValue(previous, "status", "draft")).toLowerCase();
    if (!["draft", "pending", "generated", "cancelled", "failed", "unknown"].includes(state)) throw new PetrosoftError("The service returned an unsupported document status.", 502);
    if (operation === "status" && previous.status === "pending" && Date.now() - Date.parse(String(previous.started_at || entry.updatedAt.toISOString())) < 60000) throw new PetrosoftError("The document request is still running. Check its status in a moment.", 409);
    await transaction(async database => {
      const current = await database.petrosoftEntry.findUniqueOrThrow({ where: { id: entry.id } }), fields = jsonFields(current.fields);
      const integration = { ...jsonFields(jsonFields(fields.integrations)[type]), status: state, reference, response: safeFields(response), checked_at: new Date().toISOString(), idempotency_key: key };
      await database.petrosoftEntry.update({ where: { id: entry.id }, data: { fields: safeFields({ ...fields, provider_status: state, ...(type === "einvoice" ? { irn: reference, ack_no: fieldValue(response, ["ack_no", "AckNo"]), ack_date: fieldValue(response, ["ack_date", "AckDt"]) } : { eway_bill_no: reference }), integrations: { ...jsonFields(fields.integrations), [type]: integration } }) } });
      await database.petrosoftAudit.create({ data: { workspaceId: actor.workspaceId, entryId: entry.id, userId: actor.id, username: actor.username, module: type, action: operation.toUpperCase(), after: safeFields({ status: state, reference }) } });
    });
    return { message: `${titles[type]} ${state}.`, status: state, reference };
  } catch (error) {
    if (operation !== "status") await transaction(async database => { const current = await database.petrosoftEntry.findUniqueOrThrow({ where: { id: entry.id } }), fields = jsonFields(current.fields); await database.petrosoftEntry.update({ where: { id: entry.id }, data: { fields: safeFields({ ...fields, integrations: { ...jsonFields(fields.integrations), [type]: { ...jsonFields(jsonFields(fields.integrations)[type]), status: operation === "cancel" ? "generated" : "unknown", operation, idempotency_key: key, last_error: error instanceof Error ? error.message.slice(0, 300) : "The service request failed." } } }) } }); });
    throw error;
  }
}
export async function sendCommunication(actor: PetrosoftActor, type: "sms" | "email" | "whatsapp", input: PetrosoftFields) {
  const to = fieldValue(input, "to").trim(), message = fieldValue(input, "message").trim(), subject = fieldValue(input, "subject").trim();
  if (type === "email" ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) : !/^\+?\d{10,15}$/.test(to)) throw new PetrosoftError(`Enter a valid ${type === "email" ? "email address" : "mobile number"}.`);
  if (!message || message.length > 10000) throw new PetrosoftError("Enter a message of 1 to 10,000 characters.");
  const permissionModule = fieldValue(input, "module", permissions[type]);
  const supported = type === "email" ? ["customers", "statements", "credit-sales", "recoveries", "credit-limits"] : ["customers", "credit-sales", "recoveries", "employee-recoveries", "settlements", "bowser-credit-sales", "credit-limits", "guest-sales", "gift-sales"];
  if (!supported.includes(permissionModule)) throw new PetrosoftError("Choose a supported communication module.");
  const response = await requestIntegration(actor, type, "send", { to, message, subject }, undefined, permissionModule);
  await petrosoftDb.petrosoftAudit.create({ data: { workspaceId: actor.workspaceId, userId: actor.id, username: actor.username, module: type, action: "SEND", after: safeFields({ to, reference: fieldValue(response, "reference"), status: fieldValue(response, "status", "accepted") }) } });
  return { message: `${titles[type]} request accepted by the service.`, reference: fieldValue(response, "reference") };
}
