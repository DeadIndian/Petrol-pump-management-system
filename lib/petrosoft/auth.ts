import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { petrosoftDb } from "./db";
import { supplementaryParents } from "./supplementary";

export const SESSION_COOKIE = "petrosoft_session";
export const STATION_COOKIE = "petrosoft_station";
export const SESSION_SECONDS = 60 * 60 * 12;

export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, key] = encoded.split(":");
  if (algorithm !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function sessionFromToken(token?: string) {
  if (!token) return null;
  const session = await petrosoftDb.petrosoftSession.findUnique({
    where: { tokenHash: digest(token) },
    include: { user: { include: { workspace: true } } },
  });
  if (!session || session.expiresAt.getTime() <= Date.now() || !session.user.active) return null;
  return session.user;
}

export async function getPetrosoftUser() {
  return sessionFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requestUser(request: NextRequest) {
  return sessionFromToken(request.cookies.get(SESSION_COOKIE)?.value);
}

export type PetrosoftActor = NonNullable<Awaited<ReturnType<typeof requestUser>>>;

export function hasPermission(actor: PetrosoftActor, module: string, operation = "view") {
  const permissions = Array.isArray(actor.permissions) ? actor.permissions : [];
  const parent = supplementaryParents[module];
  return permissions.includes("*") || permissions.includes(module) || permissions.includes(`${module}:${operation}`)
    || Boolean(parent && (permissions.includes(parent) || permissions.includes(`${parent}:${operation}`)));
}

export function cookieOptions(request: NextRequest) {
  return { httpOnly: true, sameSite: "lax" as const, path: "/",
    secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https" };
}

export function checkOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) {
    return NextResponse.json({ error: "This request must come from this Petrosoft installation." }, { status: 403 });
  }
  return null;
}

// A bounded, short-lived login throttle. Session data and credentials stay in PostgreSQL.
const throttle = new Map<string, { count: number; until: number }>();
export function loginThrottled(request: NextRequest, username: string) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = `${ip}:${username.toLowerCase()}`;
  const now = Date.now();
  if (throttle.size > 5000) {
    for (const [entry, value] of throttle) if (value.until < now) throttle.delete(entry);
  }
  const previous = throttle.get(key);
  if (!previous || previous.until < now) { throttle.set(key, { count: 1, until: now + 60000 }); return false; }
  previous.count++;
  return previous.count > 12;
}
