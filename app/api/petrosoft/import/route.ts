import { NextRequest, NextResponse } from "next/server";
import { authenticated, apiError } from "@/lib/petrosoft/http";
import { previewImport, commitImport } from "@/lib/petrosoft/imports";
import { jsonFields } from "@/lib/petrosoft/catalog";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const actor = await authenticated(request, true);
    if (Number(request.headers.get("content-length") || 0) > 21 * 1024 * 1024) throw new Error("The import file is too large.");
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData(), file = form.get("file");
      if (!(file instanceof File)) throw new Error("Choose a CSV or spreadsheet to import.");
      let mapping = {};
      try { mapping = JSON.parse(String(form.get("mapping") || "{}")); } catch { throw new Error("Choose valid column mappings."); }
      return NextResponse.json(await previewImport(actor, file, String(form.get("module")), String(form.get("action") || ""), jsonFields(mapping)));
    }
    const input = await request.json();
    return NextResponse.json(await commitImport(actor, String(input.module), input.rows, input.formIndex));
  } catch (error) { return apiError(error); }
}
