-- SPEC-016 approval multilevel expand: add nodeSchema to
-- ApprovalDefinition and currentNode to ApprovalInstance.
-- DDL idiom mirrors SPEC-013/015 expand migrations (JSONB / INTEGER column add).

-- AlterTable
ALTER TABLE "approval_definition" ADD COLUMN "nodeSchema" JSONB;

-- AlterTable
ALTER TABLE "approval_instance" ADD COLUMN "currentNode" INTEGER NOT NULL DEFAULT 0;
