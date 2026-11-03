ALTER TABLE "customer_profiles" ADD COLUMN "indent_start" INTEGER;
ALTER TABLE "customer_profiles" ADD COLUMN "indent_end" INTEGER;
ALTER TABLE "customer_profiles" ADD COLUMN "current_indent" INTEGER;
ALTER TABLE "orders" ADD COLUMN "indent_number" INTEGER;
ALTER TABLE "orders" ADD COLUMN "fulfilled_by_id" TEXT;

CREATE UNIQUE INDEX "orders_customer_id_indent_number_key" ON "orders" ("customer_id", "indent_number");
CREATE INDEX "orders_fulfilled_by_id_idx" ON "orders" ("fulfilled_by_id");
ALTER TABLE "orders" ADD CONSTRAINT "orders_fulfilled_by_id_fkey"
  FOREIGN KEY ("fulfilled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Accounts created before the balance refactor also need a customer profile.
INSERT INTO "customer_profiles" ("id", "user_id", "current_balance", "total_orders", "total_purchases", "updated_at")
SELECT 'profile_' || u."id", u."id",
  -COALESCE(SUM(o."total_amount") FILTER (WHERE o."status" = 'COMPLETED'), 0),
  COUNT(o."id") FILTER (WHERE o."status" = 'COMPLETED'),
  COALESCE(SUM(o."total_amount") FILTER (WHERE o."status" = 'COMPLETED'), 0), NOW()
FROM "users" u
LEFT JOIN "orders" o ON o."customer_id" = u."id"
WHERE u."role" = 'CUSTOMER'
  AND NOT EXISTS (SELECT 1 FROM "customer_profiles" p WHERE p."user_id" = u."id")
GROUP BY u."id";
