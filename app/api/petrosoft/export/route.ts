import { NextRequest } from "next/server";
import { authenticated, apiError, attachmentHeaders } from "@/lib/petrosoft/http";
import { buildReport, rowFor, type ReportResult } from "@/lib/petrosoft/report-data";
import { reportCsv, reportHtml, reportPdf, reportXlsx, tallyXml } from "@/lib/petrosoft/report-render";
import { jsonFields, moduleById } from "@/lib/petrosoft/catalog";
import { readState } from "@/lib/petrosoft/queries";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const actor = await authenticated(request, true), input = await request.json(), format = String(input.format || "xlsx").toLowerCase();
    let report: ReportResult;
    if (input.index !== undefined) report = await buildReport(actor, Number(input.index), jsonFields(input.fields));
    else {
      const module = moduleById.get(String(input.module));
      if (!module) throw new Error("Choose a valid module to export.");
      const state = await readState(actor, module.id, jsonFields(input.filters));
      const headings = module.tables[0]?.headers.filter(column => column.trim() && !/^(action|edit|delete|status|image|view|user log details|password|vehicles|pf \/ esi \/ it|add nozzles)$/i.test(column)) || ["Date", "Name", "Quantity", "Rate", "Amount", "Description"];
      report = { title: module.title, from: String(input.filters?.from || input.filters?.frm_dt || state.date), to: String(input.filters?.to || input.filters?.to_dt || state.date), sections: [{ title: module.title, columns: headings, rows: state.records.map(rowFor) }], format };
    }
    const name = report.title.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").slice(0, 70) || "Petrosoft";
    if (format === "pdf") return new Response(await reportPdf(report, actor, input.layout === "L" || report.sections.some(section => section.columns.length > 9)), { headers: attachmentHeaders(`${name}.pdf`, "application/pdf") });
    if (format === "csv") return new Response(reportCsv(report), { headers: attachmentHeaders(`${name}.csv`, "text/csv; charset=utf-8") });
    if (format === "xml") return new Response(tallyXml(report, jsonFields(actor.workspace.settings)), { headers: attachmentHeaders(`${name}.xml`, "application/xml; charset=utf-8") });
    if (format === "html") return new Response(reportHtml(report, actor), { headers: attachmentHeaders(`${name}.html`, "text/html; charset=utf-8") });
    if (format !== "xlsx") throw new Error("Choose Excel, CSV, PDF, or Tally XML.");
    return new Response(await reportXlsx(report), { headers: attachmentHeaders(`${name}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") });
  } catch (error) { return apiError(error); }
}
