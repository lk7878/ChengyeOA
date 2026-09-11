-- 漂移治理专项（2026-08-02）：schema↔DB 长期漂移对齐校正迁移。
--
-- 背景：本迁移修复 5 处 schema.prisma 与实际数据库的长期漂移，全部源于
-- 历史手写迁移 SQL 与最终 schema 不一致（自 SPEC-004 时期
-- 20260718210000_authorization_expand 起）。schema.prisma 为权威目标态，
-- 本迁移只动数据库（DB-only），不改 schema。
--
-- 实测漂移（prisma migrate diff --from-migrations → --to-schema-datamodel）：
--   1. permission.updatedAt   —— schema 为 @updatedAt（客户端写，无 DB 默认），
--       但迁移链加了 DEFAULT CURRENT_TIMESTAMP（多余残留）→ DROP DEFAULT。
--   2. user_role.validFrom    —— schema 为 @default(now())，但迁移链未加默认
--       → SET DEFAULT CURRENT_TIMESTAMP。
--   3. user_role.updatedAt    —— schema 为 @updatedAt（无 DB 默认），迁移链加了
--       DEFAULT CURRENT_TIMESTAMP（多余残留）→ DROP DEFAULT。
--   4. admin_operation 复合唯一索引名   —— 迁移手写名 admin_operation_requester_idempotency_key
--       ≠ schema 派生名 admin_operation_requesterUserId_idempotencyKey_key → RENAME。
--   5. admin_operation_execution 复合唯一索引名 —— 迁移手写名
--       admin_operation_execution_operation_attempt_key
--       ≠ schema 派生名 admin_operation_execution_operationId_attemptNo_key → RENAME。
--
-- 安全面：应用层以 Prisma 字段派生选择器（requesterUserId_idempotencyKey）查询，
-- 不依赖 DB 索引名；spec-005 契约测试读旧迁移文件（20260721120000）不受影响；
-- schema-contract 断言 user_role.validFrom @default(now()) 与本迁移目标一致。
--
-- 本迁移无表/列/权限/事件变更，仅对齐默认值与索引命名。

-- 1) permission.updatedAt：去掉多余 DB 默认（schema @updatedAt 由客户端写）
ALTER TABLE "permission" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- 2+3) user_role.validFrom 补默认 + updatedAt 去多余默认（合并一条 ALTER TABLE）
ALTER TABLE "user_role"
  ALTER COLUMN "validFrom" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updatedAt" DROP DEFAULT;

-- 4) admin_operation 复合唯一索引：重命名为 schema 派生名
ALTER INDEX "admin_operation_requester_idempotency_key" RENAME TO "admin_operation_requesterUserId_idempotencyKey_key";

-- 5) admin_operation_execution 复合唯一索引：重命名为 schema 派生名
ALTER INDEX "admin_operation_execution_operation_attempt_key" RENAME TO "admin_operation_execution_operationId_attemptNo_key";
