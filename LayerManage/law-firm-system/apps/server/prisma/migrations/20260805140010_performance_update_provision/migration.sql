-- SPEC-043 performance.update permission provisioning
-- SPEC-037 绩效三码（read/create/confirm）+ 本 SPEC performance.update（目标设定/自评自助动作）——
-- 既有 provisioning 迁移（20260805120000_performance_provision）已应用，新增补 1 行。
-- Column set identical to the performance precedent; id = 'permission:performance.update'; role_permission never touched.

INSERT INTO "permission" (
  "id", "code", "name", "parentId", "type", "resource", "action", "riskLevel", "path", "sort", "status", "version", "createdAt", "updatedAt"
) VALUES
  ('permission:performance.update', 'performance.update', '录入绩效目标/自评', NULL, 'ACTION', 'performance', 'update', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
