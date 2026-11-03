import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { checkOrigin, cookieOptions, digest, loginThrottled, SESSION_COOKIE, SESSION_SECONDS, STATION_COOKIE, verifyPassword } from "@/lib/petrosoft/auth";
import { petrosoftDb } from "@/lib/petrosoft/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originError = checkOrigin(request);
  if (originError) return originError;
  try {
    const body = request.headers.get("content-type")?.includes("application/json")
      ? await request.json() : Object.fromEntries(await request.formData());
    const action = String(body.action || "login");
    if (action === "logout" || action === "switch") {
      const token = request.cookies.get(SESSION_COOKIE)?.value;
      if (token) await petrosoftDb.petrosoftSession.deleteMany({ where: { tokenHash: digest(token) } });
      const response = NextResponse.json({ redirect: "/petrosoft" });
      response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(request), maxAge: 0 });
      if (action === "switch") response.cookies.set(STATION_COOKIE, "", { ...cookieOptions(request), maxAge: 0 });
      return response;
    }
    if (action === "station") {
      const code = String(body.reff_code || body.referenceCode || "").trim().toUpperCase();
      if (loginThrottled(request, `station:${code}`)) return NextResponse.json({ error: "Please wait a minute before trying again." }, { status: 429 });
      const workspace = code ? await petrosoftDb.petrosoftWorkspace.findUnique({ where: { referenceCode: code } }) : null;
      if (!workspace) return NextResponse.json({ error: "Please enter a valid reference code." }, { status: 400 });
      const response = NextResponse.json({ redirect: "/petrosoft/login", station: workspace.name });
      response.cookies.set(STATION_COOKIE, workspace.id, { ...cookieOptions(request), maxAge: 60 * 60 * 24 * 30 });
      return response;
    }
    const workspaceId = request.cookies.get(STATION_COOKIE)?.value;
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!workspaceId) return NextResponse.json({ error: "Select your station with its reference code first.", redirect: "/petrosoft" }, { status: 400 });
    if (loginThrottled(request, username)) return NextResponse.json({ error: "Too many login attempts. Please wait a minute." }, { status: 429 });
    const user = await petrosoftDb.petrosoftUser.findUnique({ where: { workspaceId_username: { workspaceId, username } } });
    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
    }
    const token = randomBytes(32).toString("base64url");
    await petrosoftDb.$transaction([
      petrosoftDb.petrosoftSession.create({ data: { tokenHash: digest(token), userId: user.id, expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000) } }),
      petrosoftDb.petrosoftUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    ]);
    const response = NextResponse.json({ redirect: "/petrosoft/Dashboard" });
    response.cookies.set(SESSION_COOKIE, token, { ...cookieOptions(request), maxAge: SESSION_SECONDS });
    return response;
  } catch {
    return NextResponse.json({ error: "The station database is unavailable. Start the local Petrosoft service and try again." }, { status: 503 });
  }
}
