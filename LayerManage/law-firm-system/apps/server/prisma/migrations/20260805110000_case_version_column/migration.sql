-- SPEC-035 Task 1: Case 乐观锁 version 列
-- SPEC-033 D2 设计意图收敛：Case 无 version 列时 updateCase 为 last-write-wins + 终态守卫，
-- 现补 version 列 → updateCase 改乐观锁（updateMany {id, version} → count=0 → VERSION_CONFLICT 409）。
-- 纯加列，NOT NULL DEFAULT 1 对既有行零回填；幂等（重放时列已存在则跳过）。
-- 与 cost-entry version 语义一致（成本域乐观锁先例）。

ALTER TABLE "case" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
