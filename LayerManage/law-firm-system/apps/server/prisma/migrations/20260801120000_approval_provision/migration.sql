-- SPEC-013 approval center permission + definition provisioning
-- The 3 SPEC-013 approval permission codes exist only in the code catalog
-- (app/domain/authorization/permission-catalog.ts); without these rows,
-- RolePermission/UserPermissionGrant inserts are blocked by the Permission FK
-- (onDelete: Restrict) and fresh bootstrap fails the catalog assertion on
-- migration-only databases.
-- Column set is identical to the finance precedent (20260731213000_finance_permission_provision);
-- id = 'permission:<code>' so the bootstrap catalog assertion (id === 'permission:' + code)
-- holds on migration-only databases; status = 'ENABLED' matches the catalog status.
-- Only permission rows are inserted — role_permission is never touched by provisioning
-- migrations. ON CONFLICT ("code") DO NOTHING for idempotency.
--
-- The approval_definition seed (5 rows) mirrors the same provisioning discipline:
-- "updatedAt" is NOT NULL without a database default (Prisma @updatedAt is client-side
-- only, confirmed in 20260801100000_approval_center_expand), so createdAt/updatedAt are
-- set explicitly. id uses gen_random_uuid() (brief verbatim); the approval_definition.code
-- UNIQUE index backs ON CONFLICT ("code") DO NOTHING. roleCodes reference business roles
-- (HR/SEAL_ADMIN/FINANCE/PARTNER) created via role management — approverRule is JSONB
-- configuration, not an FK (adjudicated in task-2-report.md).

INSERT INTO "permission" (
  "id", "code", "name", "parentId", "type", "resource", "action", "riskLevel", "path", "sort", "status", "version", "createdAt", "updatedAt"
) VALUES
  ('permission:approval.read', 'approval.read', '查看审批中心', NULL, 'ACTION', 'approval', 'read', 'LOW', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:approval.apply', 'approval.apply', '发起审批申请', NULL, 'ACTION', 'approval', 'apply', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:approval.process', 'approval.process', '处理审批任务', NULL, 'ACTION', 'approval', 'process', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "approval_definition" (
  "id", "code", "name", "businessType", "formSchema", "approverRule", "version", "status", "createdBy", "createdAt", "updatedAt"
) VALUES
  (gen_random_uuid(), 'LEAVE', '请假申请', 'LEAVE',
   '{"fields":[{"key":"startDate","label":"开始日期","type":"date","required":true},{"key":"endDate","label":"结束日期","type":"date","required":true},{"key":"reason","label":"事由","type":"textarea","required":true}]}',
   '{"type":"ROLE","roleCodes":["HR"]}', 1, 'ACTIVE', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SEAL', '用印申请', 'SEAL',
   '{"fields":[{"key":"sealType","label":"用印类型","type":"text","required":true},{"key":"docCount","label":"份数","type":"number","required":true}]}',
   '{"type":"ROLE","roleCodes":["SEAL_ADMIN"]}', 1, 'ACTIVE', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'EXPENSE', '费用报销', 'EXPENSE',
   '{"fields":[{"key":"amount","label":"金额","type":"number","required":true},{"key":"category","label":"类别","type":"text","required":true}]}',
   '{"type":"ROLE","roleCodes":["FINANCE"]}', 1, 'ACTIVE', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CONTRACT_CHANGE', '合同变更', 'CONTRACT_CHANGE',
   '{"fields":[{"key":"contractId","label":"合同","type":"text","required":true},{"key":"changeSummary","label":"变更摘要","type":"textarea","required":true}]}',
   '{"type":"ROLE","roleCodes":["PARTNER"]}', 1, 'ACTIVE', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'TRANSFER', '转所申请', 'TRANSFER',
   '{"fields":[{"key":"targetTeam","label":"目标团队","type":"text","required":true},{"key":"reason","label":"事由","type":"textarea","required":true}]}',
   '{"type":"ROLE","roleCodes":["HR"]}', 1, 'ACTIVE', '00000000-0000-0000-0000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
