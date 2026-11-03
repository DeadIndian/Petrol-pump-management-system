import { PrismaClient } from "@prisma/client";

const shared = globalThis as unknown as { petrosoftDb?: PrismaClient };

// A separate client allows the replica to run against its own PostgreSQL DB.
export const petrosoftDb = shared.petrosoftDb || new PrismaClient({
  ...(process.env.PETROSOFT_DATABASE_URL ? {
    datasources: { db: { url: process.env.PETROSOFT_DATABASE_URL } },
  } : {}),
  log: ["error", "warn"],
});
if (process.env.NODE_ENV !== "production") shared.petrosoftDb = petrosoftDb;
