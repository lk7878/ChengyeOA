-- SPEC-033 case domain permission provisioning
-- The 6 SPEC-033 case permission codes exist only in the code catalog
-- (app/domain/authorization/permission-catalog.ts); without these rows,
-- RolePermission/UserPermissionGrant inserts are blocked by the Permission FK
-- (onDelete: Restrict) and fresh bootstrap fails the catalog assertion on
-- migration-only databases.
-- Column set is identical to the approval precedent (20260801120000_approval_provision);
-- id = 'permission:<code>' so the bootstrap catalog assertion holds on migration-only
-- databases; status = 'ENABLED' matches the catalog status. Only permission rows are
-- inserted — role_permission is never touched. ON CONFLICT ("code") DO NOTHING.

INSERT INTO "permission" (
  "id", "code", "name", "parentId", "type", "resource", "action", "riskLevel", "path", "sort", "status", "version", "createdAt", "updatedAt"
) VALUES
  ('permission:case.read', 'case.read', '查看案件', NULL, 'ACTION', 'case', 'read', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:case.create', 'case.create', '新建案件', NULL, 'ACTION', 'case', 'create', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:case.update', 'case.update', '编辑案件', NULL, 'ACTION', 'case', 'update', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:case.close', 'case.close', '结案', NULL, 'ACTION', 'case', 'close', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:case.task.manage', 'case.task.manage', '管理案件任务', NULL, 'ACTION', 'case', 'task.manage', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:case.communication.create', 'case.communication.create', '记录案件沟通', NULL, 'ACTION', 'case', 'communication.create', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
