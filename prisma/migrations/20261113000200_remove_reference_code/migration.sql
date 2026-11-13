-- DropIndex
DROP INDEX IF EXISTS "bunkbook_workspaces_reference_code_key";

-- AlterTable
ALTER TABLE "bunkbook_workspaces" DROP COLUMN "reference_code";
