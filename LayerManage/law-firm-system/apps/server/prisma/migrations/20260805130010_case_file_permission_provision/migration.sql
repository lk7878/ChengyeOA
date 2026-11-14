-- SPEC-042 case file permission provisioning
-- The 2 SPEC-042 case file permission codes exist only in the code catalog; without these rows,
-- RolePermission/UserPermissionGrant inserts are blocked by the Permission FK and fresh bootstrap
-- fails the catalog assertion on migration-only databases. Column set identical to the case/performance
-- precedent; id = 'permission:<code>'; status = 'ENABLED'. role_permission is never touched.

INSERT INTO "permission" (
  "id", "code", "name", "parentId", "type", "resource", "action", "riskLevel", "path", "sort", "status", "version", "createdAt", "updatedAt"
) VALUES
  ('permission:case.file.read', 'case.file.read', '查看案件文件', NULL, 'ACTION', 'case', 'file.read', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:case.file.manage', 'case.file.manage', '管理案件文件', NULL, 'ACTION', 'case', 'file.manage', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
