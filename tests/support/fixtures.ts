import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { assertLocalTestDatabase, testEnvironment } from "./environment";
export const password = "LocalPump123!";
export interface FixtureUser { id: string; email: string; fullName: string; role: "ADMIN" | "EMPLOYEE" | "CUSTOMER"; }
export type Scope = { admin: FixtureUser; customer: FixtureUser; employee: FixtureUser; other: FixtureUser };
export type Fixtures = Record<"api" | "desktop" | "phone", Scope>;
export function readFixtures(): Fixtures { return JSON.parse(readFileSync("tests/.state/fixtures.json", "utf8")); }
export async function seedFixtures(reset = true) {
  Object.assign(process.env, testEnvironment); assertLocalTestDatabase();
  const prisma = new PrismaClient();
  const supabase = createClient(testEnvironment.NEXT_PUBLIC_SUPABASE_URL, testEnvironment.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    if (reset) await prisma.$executeRawUnsafe("TRUNCATE TABLE audit_logs, payments, orders, customer_profiles, fuel_prices, users CASCADE");
    const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;
    const existing = new Map(data.users.map(user => [user.email, user.id]));
    const scopes = {} as Fixtures;
    for (const scope of ["api", "desktop", "phone"] as const) {
      const users = {} as Scope;
      for (const kind of ["admin", "customer", "employee", "other"] as const) {
        const email = `${scope}-${kind}@petrol.local`;
        const role = kind === "other" ? "CUSTOMER" : kind.toUpperCase() as FixtureUser["role"];
        let id = existing.get(email);
        if (id) {
          const updated = await supabase.auth.admin.updateUserById(id, { password, email_confirm: true });
          if (updated.error) throw updated.error;
        } else {
          const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
          if (created.error || !created.data.user) throw created.error || new Error("Could not seed test user");
          id = created.data.user.id;
        }
        const fullName = `${scope[0].toUpperCase() + scope.slice(1)} ${kind[0].toUpperCase() + kind.slice(1)}`;
        const user = await prisma.user.upsert({ where: { id }, update: {}, create: {
          id, email, fullName, role, ...(role === "CUSTOMER" && { customerProfile: { create: {} } }),
        } });
        users[kind] = { id: user.id, email, fullName, role };
      }
      scopes[scope] = users;
    }
    mkdirSync("tests/.state", { recursive: true });
    writeFileSync("tests/.state/fixtures.json", JSON.stringify(scopes, null, 2));
    return scopes;
  } finally { await prisma.$disconnect(); }
}
