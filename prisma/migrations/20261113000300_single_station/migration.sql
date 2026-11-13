-- One installation serves one station. Refuse to run if several stations exist.
DO $$
BEGIN
  IF (SELECT count(*) FROM "bunkbook_workspaces") > 1 THEN
    RAISE EXCEPTION 'Multiple stations found in bunkbook_workspaces. Split them into separate databases before applying this migration.';
  END IF;
END $$;

-- CreateTable
CREATE TABLE "bunkbook_station" (
    "id" TEXT NOT NULL DEFAULT 'station',
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bunkbook_station_pkey" PRIMARY KEY ("id")
);

INSERT INTO "bunkbook_station" ("id", "name", "settings", "created_at", "updated_at")
SELECT 'station', "name", "settings", "created_at", "updated_at" FROM "bunkbook_workspaces" LIMIT 1;

-- Drop workspace_id (this also drops the foreign keys and every index that included it)
ALTER TABLE "bunkbook_users" DROP COLUMN "workspace_id";
ALTER TABLE "bunkbook_sequences" DROP COLUMN "workspace_id";
ALTER TABLE "bunkbook_entries" DROP COLUMN "workspace_id";
ALTER TABLE "bunkbook_attachments" DROP COLUMN "workspace_id";
ALTER TABLE "bunkbook_audits" DROP COLUMN "workspace_id";
ALTER TABLE "bunkbook_native_records" DROP COLUMN "workspace_id";

DROP TABLE "bunkbook_workspaces";

-- Recreate uniqueness and indexes without the workspace
CREATE UNIQUE INDEX "bunkbook_users_username_key" ON "bunkbook_users"("username");
CREATE UNIQUE INDEX "bunkbook_sequences_module_key" ON "bunkbook_sequences"("module");
CREATE UNIQUE INDEX "bunkbook_entries_module_number_key" ON "bunkbook_entries"("module", "number");
CREATE UNIQUE INDEX "bunkbook_entries_module_external_id_key" ON "bunkbook_entries"("module", "external_id");
CREATE INDEX "bunkbook_entries_module_date_idx" ON "bunkbook_entries"("module", "date");
CREATE INDEX "bunkbook_audits_created_at_idx" ON "bunkbook_audits"("created_at");
CREATE UNIQUE INDEX "bunkbook_native_records_table_name_native_id_key" ON "bunkbook_native_records"("table_name", "native_id");
CREATE INDEX "bunkbook_native_records_table_name_idx" ON "bunkbook_native_records"("table_name");
