-- SPEC-010 negotiation/contract/payment permission provisioning
-- Same discipline as 20260730090000_crm_permission_provision: the 16 SPEC-010 permission
-- codes exist only in the code catalog (app/domain/authorization/permission-catalog.ts);
-- without these rows, RolePermission/UserPermissionGrant inserts are blocked by the
-- Permission FK (onDelete: Restrict) and fresh bootstrap fails the catalog assertion on
-- migration-only databases.
-- Column set is identical to the CRM precedent; id = 'permission:<code>';
-- ON CONFLICT ("code") DO NOTHING for idempotency. Only permission rows are inserted —
-- role_permission is never touched by provisioning migrations.

INSERT INTO "permission" (
  "id", "code", "name", "parentId", "type", "resource", "action", "riskLevel", "path", "sort", "status", "version", "createdAt", "updatedAt"
) VALUES
  ('permission:menu.contract', 'menu.contract', '合同管理', NULL, 'MENU', 'menu', 'view', 'LOW', '/contracts', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:menu.payment', 'menu.payment', '收款管理', NULL, 'MENU', 'menu', 'view', 'LOW', '/payments', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:negotiation.read', 'negotiation.read', '查看谈案', NULL, 'ACTION', 'negotiation', 'read', 'LOW', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:negotiation.create', 'negotiation.create', '创建谈案', NULL, 'ACTION', 'negotiation', 'create', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:negotiation.update', 'negotiation.update', '修改谈案', NULL, 'ACTION', 'negotiation', 'update', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:contract.read', 'contract.read', '查看合同', NULL, 'ACTION', 'contract', 'read', 'LOW', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:contract.create', 'contract.create', '创建合同', NULL, 'ACTION', 'contract', 'create', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:contract.submit', 'contract.submit', '提交合同', NULL, 'ACTION', 'contract', 'submit', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:contract.approve', 'contract.approve', '审批合同', NULL, 'ACTION', 'contract', 'approve', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:contract.sign', 'contract.sign', '签署合同', NULL, 'ACTION', 'contract', 'sign', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:contract.effect', 'contract.effect', '合同生效', NULL, 'ACTION', 'contract', 'effect', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:contract.terminate', 'contract.terminate', '终止合同', NULL, 'ACTION', 'contract', 'terminate', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:contract.void', 'contract.void', '作废合同', NULL, 'ACTION', 'contract', 'void', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:payment.read', 'payment.read', '查看收款', NULL, 'ACTION', 'payment', 'read', 'LOW', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:payment.create', 'payment.create', '创建收款', NULL, 'ACTION', 'payment', 'create', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:payment.confirm', 'payment.confirm', '确认收款', NULL, 'ACTION', 'payment', 'confirm', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- contract.void / payment.confirm pre-exist since 20260718210000_authorization_expand as
-- inert SPECIAL/CRITICAL placeholders; SPEC-010 promotes them to live ACTION/HIGH codes.
-- ON CONFLICT DO NOTHING above cannot update pre-existing rows, so align type/riskLevel
-- explicitly (name/resource/action already match the catalog; statement is idempotent).
UPDATE "permission"
SET "type" = 'ACTION', "riskLevel" = 'HIGH', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('contract.void', 'payment.confirm');
