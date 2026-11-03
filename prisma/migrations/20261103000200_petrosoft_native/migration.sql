CREATE TABLE "petrosoft_native_records" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "table_name" TEXT NOT NULL,
  "native_id" TEXT NOT NULL,
  "fields" JSONB NOT NULL,
  CONSTRAINT "petrosoft_native_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "petrosoft_native_records_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "petrosoft_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "petrosoft_native_records_workspace_id_table_name_native_id_key" ON "petrosoft_native_records"("workspace_id", "table_name", "native_id");
CREATE INDEX "petrosoft_native_records_workspace_id_table_name_idx" ON "petrosoft_native_records"("workspace_id", "table_name");
