import { NextRequest, NextResponse } from "next/server";
import { authenticated, apiError } from "@/lib/petrosoft/http";
import { hasPermission } from "@/lib/petrosoft/auth";
import { PetrosoftError } from "@/lib/petrosoft/actions";
import { jsonFields } from "@/lib/petrosoft/catalog";
import { petrosoftDb } from "@/lib/petrosoft/db";
import { governmentDocument, integrationStatus, integrationType, requestIntegration, sendCommunication } from "@/lib/petrosoft/integrations";
import { safeFields } from "@/lib/petrosoft/rules";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try { await authenticated(request); return NextResponse.json({ services: integrationStatus() }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return apiError(error); }
}
export async function POST(request: NextRequest) {
  try {
    const actor = await authenticated(request, true), input = await request.json(), type = integrationType(input.type), fields = jsonFields(input.fields);
    if (type === "einvoice" || type === "eway") return NextResponse.json(await governmentDocument(actor, type, String(input.operation || "generate"), String(input.id || ""), fields));
    if (type === "sms" || type === "email" || type === "whatsapp") return NextResponse.json(await sendCommunication(actor, type, fields));
    if (type === "biometric") {
      if (!hasPermission(actor, "employees", "edit")) throw new PetrosoftError("Your role cannot use the biometric device.", 403);
      if (input.operation && !["employees", "status"].includes(input.operation)) throw new PetrosoftError("Choose Push Employees or Device Status.");
      const employees = await petrosoftDb.petrosoftEntry.findMany({ where: { workspaceId: actor.workspaceId, module: "employees", status: "active" }, select: { externalId: true, name: true, fields: true } });
      const response = await requestIntegration(actor, type, String(input.operation || "employees"), { employees: employees.map(employee => ({ id: employee.externalId, name: employee.name, fields: safeFields(jsonFields(employee.fields)) })) });
      await petrosoftDb.petrosoftAudit.create({ data: { workspaceId: actor.workspaceId, userId: actor.id, username: actor.username, module: "biometric", action: String(input.operation || "employees").toUpperCase(), after: safeFields({ employees: employees.length }) } });
      return NextResponse.json({ ...response, message: response.message || "The biometric service accepted the employee request." });
    }
    if (input.operation && input.operation !== "transactions") throw new PetrosoftError("Choose Fleet Transactions.");
    return NextResponse.json(await requestIntegration(actor, type, String(input.operation || "transactions"), fields));
  } catch (error) { return apiError(error); }
}
