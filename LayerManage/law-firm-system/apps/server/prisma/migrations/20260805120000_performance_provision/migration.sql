-- SPEC-037 performance domain permission provisioning
-- The 3 SPEC-037 performance permission codes exist only in the code catalog
-- (app/domain/authorization/permission-catalog.ts); without these rows,
-- RolePermission/UserPermissionGrant inserts are blocked by the Permission FK
-- (onDelete: Restrict) and fresh bootstrap fails the catalog assertion on
-- migration-only databases.
-- Column set is identical to the approval/case precedent (20260801120000_approval_provision,
-- 20260805100000_case_permission_provision); id = 'permission:<code>' so the bootstrap
-- catalog assertion holds on migration-only databases; status = 'ENABLED' matches the
-- catalog status. Only permission rows are inserted — role_permission is never touched.
-- ON CONFLICT ("code") DO NOTHING.

INSERT INTO "permission" (
  "id", "code", "name", "parentId", "type", "resource", "action", "riskLevel", "path", "sort", "status", "version", "createdAt", "updatedAt"
) VALUES
  ('permission:performance.read', 'performance.read', '查看绩效', NULL, 'ACTION', 'performance', 'read', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:performance.create', 'performance.create', '录入绩效', NULL, 'ACTION', 'performance', 'create', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:performance.confirm', 'performance.confirm', '确认绩效', NULL, 'ACTION', 'performance', 'confirm', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
