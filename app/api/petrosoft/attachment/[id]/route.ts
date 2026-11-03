import { NextRequest } from "next/server";
import { authenticated, apiError, attachmentHeaders } from "@/lib/petrosoft/http";
import { readAttachment } from "@/lib/petrosoft/attachments";

export const runtime = "nodejs";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticated(request), { id } = await params, { attachment, bytes } = await readAttachment(actor, id);
    const headers = attachmentHeaders(attachment.filename, attachment.contentType);
    if (/^image\/(png|jpeg|gif|webp)$/.test(attachment.contentType) || attachment.contentType === "application/pdf") headers["Content-Disposition"] = `inline; filename="${attachment.filename.replace(/[^a-zA-Z0-9._ -]/g, "_")}"`;
    return new Response(bytes, { headers: { ...headers, "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch (error) { return apiError(error); }
}
