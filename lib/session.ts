import { cache } from "react";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase";

export const getSessionUser = cache(async () => {
  const token = (await cookies()).get("auth_token")?.value;
  if (!token) return null;
  const { data, error } = await createSupabaseServerClient().auth.getUser(token);
  if (error || !data.user) return null;
  return prisma.user.findUnique({
    where: { id: data.user.id },
    select: { id: true, email: true, fullName: true, role: true, phone: true },
  });
});

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

export function setSessionCookies(
  response: NextResponse,
  request: NextRequest,
  session: { access_token: string; refresh_token: string; expires_in: number },
) {
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
    path: "/",
  };
  response.cookies.set("auth_token", session.access_token, { ...options, maxAge: session.expires_in });
  response.cookies.set("refresh_token", session.refresh_token, { ...options, maxAge: 60 * 60 * 24 * 30 });
  response.cookies.set("user_role", "", { ...options, maxAge: 0 });
  return response;
}

export function clearSessionCookies(response: NextResponse) {
  for (const name of ["auth_token", "refresh_token", "user_role"]) {
    response.cookies.set(name, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  }
  return response;
}
