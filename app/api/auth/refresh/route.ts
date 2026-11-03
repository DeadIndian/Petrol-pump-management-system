import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookies, setSessionCookies } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase";

async function refresh(request: NextRequest, redirect: boolean) {
  const token = request.cookies.get("refresh_token")?.value;
  if (token) {
    const { data, error } = await createSupabaseServerClient().auth.refreshSession({ refresh_token: token });
    if (!error && data.session) {
      const response = redirect
        ? new NextResponse(null, { status: 307, headers: { Location: "/dashboard" } })
        : NextResponse.json({ message: "Session refreshed" });
      return setSessionCookies(response, request, data.session);
    }
  }
  return clearSessionCookies(redirect
    ? new NextResponse(null, { status: 307, headers: { Location: "/login?expired=1" } })
    : NextResponse.json({ error: "Please sign in again" }, { status: 401 }));
}

export async function POST(request: NextRequest) { return refresh(request, false); }
export async function GET(request: NextRequest) { return refresh(request, true); }
