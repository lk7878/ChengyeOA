-- Permission provisioning gap closure.
--
-- Two catalog codes exist only in the code catalog
-- (app/domain/authorization/permission-catalog.ts) and were NEVER provisioned
-- by any migration: `approval.manage` (SPEC-017 approval definition management)
-- and `user_role.membership.manage` (role-membership assignment). Without these
-- rows, a fresh `prisma migrate deploy` database has 133 permission rows while
-- the catalog has 135, and `system:bootstrap` fails its `assertPermissionCatalog`
-- check ("Permission catalog is inconsistent") on migration-only databases.
--
-- Discipline mirrors 20260801120000_approval_provision (SPEC-013 precedent):
--   - id = 'permission:<code>' so the bootstrap catalog assertion
--     (id === 'permission:' + code) holds on migration-only databases;
--   - status = 'ENABLED' matches the catalog status;
--   - column set identical to the finance/approval provision precedents;
--   - ON CONFLICT ("code") DO NOTHING for idempotency (DBs already carrying the
--     rows — e.g. the pre-packaged seed — apply as a no-op);
--   - role_permission is never touched by provisioning migrations.

INSERT INTO "permission" (
  "id", "code", "name", "parentId", "type", "resource", "action", "riskLevel", "path", "sort", "status", "version", "createdAt", "updatedAt"
) VALUES
  ('permission:approval.manage', 'approval.manage', '管理审批定义', NULL, 'ACTION', 'approval', 'manage', 'LOW', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:user_role.membership.manage', 'user_role.membership.manage', '管理角色成员', NULL, 'ACTION', 'user_role_membership', 'manage', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
