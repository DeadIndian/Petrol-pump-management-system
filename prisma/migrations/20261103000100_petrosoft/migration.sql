-- CreateTable
CREATE TABLE "petrosoft_workspaces" (
    "id" TEXT NOT NULL,
    "reference_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "petrosoft_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "petrosoft_users" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'Super Admin',
    "permissions" JSONB NOT NULL DEFAULT '["*"]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "petrosoft_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "petrosoft_sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "petrosoft_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "petrosoft_sequences" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "petrosoft_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "petrosoft_entries" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "external_id" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "fields" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "petrosoft_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "petrosoft_ledger" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "petrosoft_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "petrosoft_attachments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "storage_name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "petrosoft_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "petrosoft_audits" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "entry_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "petrosoft_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "petrosoft_workspaces_reference_code_key" ON "petrosoft_workspaces"("reference_code");

-- CreateIndex
CREATE UNIQUE INDEX "petrosoft_users_workspace_id_username_key" ON "petrosoft_users"("workspace_id", "username");

-- CreateIndex
CREATE UNIQUE INDEX "petrosoft_sessions_token_hash_key" ON "petrosoft_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "petrosoft_sessions_expires_at_idx" ON "petrosoft_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "petrosoft_sequences_workspace_id_module_key" ON "petrosoft_sequences"("workspace_id", "module");

-- CreateIndex
CREATE INDEX "petrosoft_entries_workspace_id_module_date_idx" ON "petrosoft_entries"("workspace_id", "module", "date");

-- CreateIndex
CREATE UNIQUE INDEX "petrosoft_entries_workspace_id_module_number_key" ON "petrosoft_entries"("workspace_id", "module", "number");

-- CreateIndex
CREATE UNIQUE INDEX "petrosoft_entries_workspace_id_module_external_id_key" ON "petrosoft_entries"("workspace_id", "module", "external_id");

-- CreateIndex
CREATE INDEX "petrosoft_ledger_entity_type_entity_id_date_idx" ON "petrosoft_ledger"("entity_type", "entity_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "petrosoft_attachments_storage_name_key" ON "petrosoft_attachments"("storage_name");

-- CreateIndex
CREATE INDEX "petrosoft_audits_workspace_id_created_at_idx" ON "petrosoft_audits"("workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "petrosoft_users" ADD CONSTRAINT "petrosoft_users_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "petrosoft_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petrosoft_sessions" ADD CONSTRAINT "petrosoft_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "petrosoft_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petrosoft_sequences" ADD CONSTRAINT "petrosoft_sequences_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "petrosoft_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petrosoft_entries" ADD CONSTRAINT "petrosoft_entries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "petrosoft_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petrosoft_ledger" ADD CONSTRAINT "petrosoft_ledger_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "petrosoft_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petrosoft_attachments" ADD CONSTRAINT "petrosoft_attachments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "petrosoft_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petrosoft_audits" ADD CONSTRAINT "petrosoft_audits_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "petrosoft_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

