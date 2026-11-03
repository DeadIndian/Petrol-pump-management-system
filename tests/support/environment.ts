import { createHmac } from "node:crypto";

// Disposable, local-only credentials. These are never a production fallback.
const secret = "petrol-pump-isolated-e2e-jwt-secret-at-least-32-characters";

function testKey(role: "anon" | "service_role") {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "supabase", role, iat: 1700000000, exp: 4102444800 })).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export const testEnvironment = {
  DATABASE_URL: "postgresql://postgres:petrol-test-password@127.0.0.1:54329/petrol_test?schema=public",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54328",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: testKey("anon"),
  SUPABASE_SERVICE_ROLE_KEY: testKey("service_role"),
};

export function assertLocalTestDatabase() {
  const database = new URL(process.env.DATABASE_URL || "");
  if (database.hostname !== "127.0.0.1" || database.port !== "54329" || database.pathname !== "/petrol_test") {
    throw new Error("End-to-end checks may only modify the isolated local petrol_test database on port 54329.");
  }
}
