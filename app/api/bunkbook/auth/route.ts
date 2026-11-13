import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { checkOrigin, cookieOptions, digest, loginThrottled, SESSION_COOKIE, SESSION_SECONDS, verifyPassword } from "@/lib/bunkbook/auth";
import { bunkbookDb } from "@/lib/bunkbook/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originError = checkOrigin(request);
  if (originError) return originError;
  try {
    const body = request.headers.get("content-type")?.includes("application/json")
      ? await request.json() : Object.fromEntries(await request.formData());
    const action = String(body.action || "login");
    if (action === "logout") {
      const token = request.cookies.get(SESSION_COOKIE)?.value;
      if (token) await bunkbookDb.bunkBookSession.deleteMany({ where: { tokenHash: digest(token) } });
      const response = NextResponse.json({ redirect: "/bunkbook" });
      response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(request), maxAge: 0 });
      return response;
    }
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (loginThrottled(request, username)) return NextResponse.json({ error: "Too many login attempts. Please wait a minute." }, { status: 429 });
    const candidates = username ? await bunkbookDb.bunkBookUser.findMany({ where: { username, active: true } }) : [];
    const user = candidates.find(candidate => verifyPassword(password, candidate.passwordHash));
    if (!user) {
      return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
    }
    const token = randomBytes(32).toString("base64url");
    await bunkbookDb.$transaction([
      bunkbookDb.bunkBookSession.create({ data: { tokenHash: digest(token), userId: user.id, expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000) } }),
      bunkbookDb.bunkBookUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    ]);
    const response = NextResponse.json({ redirect: "/bunkbook/Dashboard" });
    response.cookies.set(SESSION_COOKIE, token, { ...cookieOptions(request), maxAge: SESSION_SECONDS });
    return response;
  } catch {
    return NextResponse.json({ error: "The station database is unavailable. Start the local BunkBook service and try again." }, { status: 503 });
  }
}
