import { NextRequest, NextResponse } from "next/server";
import { checkOrigin, requestUser, type PetrosoftActor } from "./auth";
import { PetrosoftError } from "./actions";

export async function authenticated(request: NextRequest, write = false): Promise<PetrosoftActor> {
  if (write && checkOrigin(request)) throw new PetrosoftError("This request must come from this Petrosoft installation.", 403);
  const actor = await requestUser(request);
  if (!actor) throw new PetrosoftError("Sign in to Petrosoft.", 401);
  return actor;
}
export function apiError(error: unknown) {
  const status = error instanceof PetrosoftError ? error.status : 400;
  const message = error instanceof Error && !/prisma|database|query|Invalid.*invocation/i.test(error.message) ? error.message : "Unable to complete this operation. Please try again.";
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}
export function attachmentHeaders(filename: string, contentType: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120);
  return { "Content-Type": contentType, "Content-Disposition": `attachment; filename="${safe}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
}
