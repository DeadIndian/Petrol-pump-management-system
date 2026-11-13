import { NextRequest, NextResponse } from "next/server";
import { authenticated, apiError, attachmentHeaders } from "@/lib/bunkbook/http";
import { hasPermission } from "@/lib/bunkbook/auth";
import { bunkbookDb } from "@/lib/bunkbook/db";
import { BunkBookError } from "@/lib/bunkbook/actions";
import { documentReport } from "@/lib/bunkbook/documents";
import { projectedReport, reportHtml, reportPdf, reportXlsx } from "@/lib/bunkbook/report-render";
import { viewHeaders } from "@/lib/bunkbook/render";

export const runtime = "nodejs";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticated(request), { id } = await params;
    const entry = await bunkbookDb.bunkBookEntry.findFirst({ where: { id, status: { not: "void" } } });
    if (!entry) throw new BunkBookError("Document not found.", 404);
    if (!hasPermission(actor, entry.module)) throw new BunkBookError("Your role cannot open this document.", 403);
    const report = documentReport(entry), format = request.nextUrl.searchParams.get("format");
    if (["pdf", "xlsx"].includes(format || "") && !hasPermission(actor, entry.module, "export")) throw new BunkBookError("Your role cannot export this document.", 403);
    if (format === "pdf") return new Response(await reportPdf(report, actor), { headers: attachmentHeaders(`BunkBook-${entry.number}.pdf`, "application/pdf") });
    if (format === "xlsx") return new Response(await reportXlsx(report), { headers: attachmentHeaders(`BunkBook-${entry.number}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") });
    if (format === "json") return NextResponse.json(projectedReport(report), { headers: { "Cache-Control": "private, no-store" } });
    return new Response(reportHtml(report, actor), { headers: viewHeaders });
  } catch (error) { return apiError(error); }
}
