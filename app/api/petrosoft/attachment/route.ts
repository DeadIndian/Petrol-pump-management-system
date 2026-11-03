import { NextRequest, NextResponse } from "next/server";
import { authenticated, apiError } from "@/lib/petrosoft/http";
import { uploadAttachment } from "@/lib/petrosoft/attachments";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const actor = await authenticated(request, true);
    if (Number(request.headers.get("content-length") || 0) > 21 * 1024 * 1024) throw new Error("Choose a file smaller than 20 MB.");
    const form = await request.formData(), file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a file to upload.");
    return NextResponse.json(await uploadAttachment(actor, file, String(form.get("module") || "organization")));
  } catch (error) { return apiError(error); }
}
