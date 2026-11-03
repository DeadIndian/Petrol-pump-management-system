import { NextRequest, NextResponse } from "next/server";
import { authenticated, apiError, attachmentHeaders } from "@/lib/petrosoft/http";
import { hasPermission } from "@/lib/petrosoft/auth";
import { petrosoftDb } from "@/lib/petrosoft/db";
import { PetrosoftError } from "@/lib/petrosoft/actions";
import { documentReport } from "@/lib/petrosoft/documents";
import { projectedReport, reportHtml, reportPdf, reportXlsx } from "@/lib/petrosoft/report-render";
import { viewHeaders } from "@/lib/petrosoft/render";

export const runtime = "nodejs";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticated(request), { id } = await params;
    const entry = await petrosoftDb.petrosoftEntry.findFirst({ where: { id, workspaceId: actor.workspaceId, status: { not: "void" } } });
    if (!entry) throw new PetrosoftError("Document not found.", 404);
    if (!hasPermission(actor, entry.module)) throw new PetrosoftError("Your role cannot open this document.", 403);
    const report = documentReport(entry), format = request.nextUrl.searchParams.get("format");
    if (["pdf", "xlsx"].includes(format || "") && !hasPermission(actor, entry.module, "export")) throw new PetrosoftError("Your role cannot export this document.", 403);
    if (format === "pdf") return new Response(await reportPdf(report, actor), { headers: attachmentHeaders(`Petrosoft-${entry.number}.pdf`, "application/pdf") });
    if (format === "xlsx") return new Response(await reportXlsx(report), { headers: attachmentHeaders(`Petrosoft-${entry.number}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") });
    if (format === "json") return NextResponse.json(projectedReport(report), { headers: { "Cache-Control": "private, no-store" } });
    return new Response(reportHtml(report, actor), { headers: viewHeaders });
  } catch (error) { return apiError(error); }
}
