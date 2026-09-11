-- SPEC-043 Task 1: 绩效考核流程——Performance +7 列（目标/自评/主管评）
-- 状态机扩展 PENDING → SELF_REVIEWED → MANAGER_REVIEWED → CONFIRMED（既有行 status=PENDING 兼容）。
-- 全列可空（NOT NULL 约束无——既有行零回填）。

ALTER TABLE "performance" ADD COLUMN "goal" TEXT;
ALTER TABLE "performance" ADD COLUMN "selfScore" INTEGER;
ALTER TABLE "performance" ADD COLUMN "selfComment" TEXT;
ALTER TABLE "performance" ADD COLUMN "managerScore" INTEGER;
ALTER TABLE "performance" ADD COLUMN "managerComment" TEXT;
ALTER TABLE "performance" ADD COLUMN "reviewerId" TEXT;
ALTER TABLE "performance" ADD COLUMN "reviewedAt" TIMESTAMP(3);
