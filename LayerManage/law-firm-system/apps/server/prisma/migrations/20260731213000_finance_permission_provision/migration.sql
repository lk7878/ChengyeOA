-- SPEC-011 finance operations (invoice/refund/cost/anomaly) permission provisioning
-- Same discipline as 20260730150000_contract_permission_provision: the 17 SPEC-011
-- permission codes exist only in the code catalog
-- (app/domain/authorization/permission-catalog.ts); without these rows,
-- RolePermission/UserPermissionGrant inserts are blocked by the Permission FK
-- (onDelete: Restrict) and fresh bootstrap fails the catalog assertion on
-- migration-only databases.
-- Column set is identical to the contract precedent; id = 'permission:<code>';
-- ON CONFLICT ("code") DO NOTHING for idempotency. Only permission rows are
-- inserted — role_permission is never touched by provisioning migrations.
-- refund.approve pre-exists since 20260718210000_authorization_expand as a live
-- SPECIAL/CRITICAL catalog entry and stays untouched (SPEC-011 governance
-- semantics), so this migration has no UPDATE section.

INSERT INTO "permission" (
  "id", "code", "name", "parentId", "type", "resource", "action", "riskLevel", "path", "sort", "status", "version", "createdAt", "updatedAt"
) VALUES
  ('permission:menu.invoice', 'menu.invoice', '开票管理', NULL, 'MENU', 'menu', 'view', 'LOW', '/invoices', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:menu.refund', 'menu.refund', '退款减免', NULL, 'MENU', 'menu', 'view', 'LOW', '/refunds', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:menu.cost', 'menu.cost', '成本管理', NULL, 'MENU', 'menu', 'view', 'LOW', '/costs', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:menu.anomaly', 'menu.anomaly', '异常数据', NULL, 'MENU', 'menu', 'view', 'LOW', '/anomalies', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:invoice.read', 'invoice.read', '查看开票', NULL, 'ACTION', 'invoice', 'read', 'LOW', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:invoice.create', 'invoice.create', '创建开票申请', NULL, 'ACTION', 'invoice', 'create', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:invoice.approve', 'invoice.approve', '审核开票', NULL, 'ACTION', 'invoice', 'approve', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:invoice.complete', 'invoice.complete', '完成开票', NULL, 'ACTION', 'invoice', 'complete', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:refund.read', 'refund.read', '查看退款减免', NULL, 'ACTION', 'refund', 'read', 'LOW', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:refund.create', 'refund.create', '创建退款减免申请', NULL, 'ACTION', 'refund', 'create', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:refund.execute', 'refund.execute', '执行退款减免', NULL, 'ACTION', 'refund', 'execute', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:payment.void', 'payment.void', '冲销收款', NULL, 'ACTION', 'payment', 'void', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:cost.read', 'cost.read', '查看成本', NULL, 'ACTION', 'cost', 'read', 'LOW', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:cost.create', 'cost.create', '记录成本', NULL, 'ACTION', 'cost', 'create', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:cost.update', 'cost.update', '修改成本', NULL, 'ACTION', 'cost', 'update', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:cost.delete', 'cost.delete', '删除成本', NULL, 'ACTION', 'cost', 'delete', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:anomaly.read', 'anomaly.read', '查看异常数据', NULL, 'ACTION', 'anomaly', 'read', 'LOW', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
