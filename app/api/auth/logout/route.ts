import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookies } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const token = request.cookies.get("auth_token")?.value;
  if (token) await createSupabaseServerClient().auth.admin.signOut(token);
  return clearSessionCookies(NextResponse.json({ message: "Signed out" }));
}
