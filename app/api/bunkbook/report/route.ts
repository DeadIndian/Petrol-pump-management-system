import { NextRequest, NextResponse } from "next/server";
import { authenticated, apiError } from "@/lib/bunkbook/http";
import { buildReport } from "@/lib/bunkbook/report-data";
import { projectedReport, reportHtml } from "@/lib/bunkbook/report-render";
import { jsonFields } from "@/lib/bunkbook/catalog";
import { viewHeaders } from "@/lib/bunkbook/render";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const actor = await authenticated(request, true), input = await request.json();
    const report = await buildReport(actor, Number(input.index), jsonFields(input.fields));
    return NextResponse.json(projectedReport(report), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
export async function GET(request: NextRequest) {
  try {
    const actor = await authenticated(request), index = Number(request.nextUrl.searchParams.get("index"));
    const fields = Object.fromEntries([...new Set(request.nextUrl.searchParams.keys())].map(key => [key, key.endsWith("[]") || request.nextUrl.searchParams.getAll(key).length > 1 ? request.nextUrl.searchParams.getAll(key) : request.nextUrl.searchParams.get(key)]));
    const report = await buildReport(actor, index, fields);
    return new Response(reportHtml(report, actor), { headers: viewHeaders });
  } catch (error) { return apiError(error); }
}
