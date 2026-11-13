import { PrismaClient } from "@prisma/client";

const shared = globalThis as unknown as { bunkbookDb?: PrismaClient };

// A separate client allows BunkBook to run against its own PostgreSQL DB.
export const bunkbookDb = shared.bunkbookDb || new PrismaClient({
  ...(process.env.BUNKBOOK_DATABASE_URL ? {
    datasources: { db: { url: process.env.BUNKBOOK_DATABASE_URL } },
  } : {}),
  log: ["error", "warn"],
});
if (process.env.NODE_ENV !== "production") shared.bunkbookDb = bunkbookDb;
