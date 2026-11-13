import { NextRequest, NextResponse } from "next/server";
import { authenticated, apiError } from "@/lib/bunkbook/http";
import { hasPermission } from "@/lib/bunkbook/auth";
import { BunkBookError } from "@/lib/bunkbook/actions";
import { jsonFields } from "@/lib/bunkbook/catalog";
import { bunkbookDb } from "@/lib/bunkbook/db";
import { governmentDocument, integrationStatus, integrationType, requestIntegration, sendCommunication } from "@/lib/bunkbook/integrations";
import { safeFields } from "@/lib/bunkbook/rules";

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
      if (!hasPermission(actor, "employees", "edit")) throw new BunkBookError("Your role cannot use the biometric device.", 403);
      if (input.operation && !["employees", "status"].includes(input.operation)) throw new BunkBookError("Choose Push Employees or Device Status.");
      const employees = await bunkbookDb.bunkBookEntry.findMany({ where: { module: "employees", status: "active" }, select: { externalId: true, name: true, fields: true } });
      const response = await requestIntegration(actor, type, String(input.operation || "employees"), { employees: employees.map(employee => ({ id: employee.externalId, name: employee.name, fields: safeFields(jsonFields(employee.fields)) })) });
      await bunkbookDb.bunkBookAudit.create({ data: { userId: actor.id, username: actor.username, module: "biometric", action: String(input.operation || "employees").toUpperCase(), after: safeFields({ employees: employees.length }) } });
      return NextResponse.json({ ...response, message: response.message || "The biometric service accepted the employee request." });
    }
    if (input.operation && input.operation !== "transactions") throw new BunkBookError("Choose Fleet Transactions.");
    return NextResponse.json(await requestIntegration(actor, type, String(input.operation || "transactions"), fields));
  } catch (error) { return apiError(error); }
}
