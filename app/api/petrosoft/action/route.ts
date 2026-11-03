import { NextRequest, NextResponse } from "next/server";
import { checkOrigin, requestUser } from "@/lib/petrosoft/auth";
import { executeAction, PetrosoftError } from "@/lib/petrosoft/actions";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const originError = checkOrigin(request);
  if (originError) return originError;
  try {
    const actor = await requestUser(request);
    if (!actor) return NextResponse.json({ error: "Sign in to Petrosoft." }, { status: 401 });
    if (Number(request.headers.get("content-length") || 0) > 8 * 1024 * 1024) return NextResponse.json({ error: "This request is too large." }, { status: 413 });
    const input = await request.json();
    return NextResponse.json(await executeAction(actor, input));
  } catch (error) {
    if (error instanceof PetrosoftError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && /unique constraint/i.test(error.message)) return NextResponse.json({ error: "An entry with these details already exists." }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error && !/prisma|query|database/i.test(error.message) ? error.message : "Unable to save this entry. Please try again." }, { status: 400 });
  }
}
