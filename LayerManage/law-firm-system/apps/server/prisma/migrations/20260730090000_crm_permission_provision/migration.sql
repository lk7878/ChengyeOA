-- SPEC-009 CRM permission provisioning
-- The 15 SPEC-009 CRM permission codes existed only in the code catalog
-- (app/domain/authorization/permission-catalog.ts); prior baselines provisioned
-- permission rows via migration INSERTs (authorization_expand, admin_governance_expand,
-- reliable_event_center). Without these rows, RolePermission/UserPermissionGrant
-- inserts are blocked by the Permission FK (onDelete: Restrict) and fresh bootstrap
-- fails the 87-entry catalog assertion on migration-only databases.
-- Pattern follows the two most recent precedents: same column set, id = 'permission:<code>',
-- ON CONFLICT ("code") DO NOTHING for idempotency.

INSERT INTO "permission" (
  "id", "code", "name", "parentId", "type", "resource", "action", "riskLevel", "path", "sort", "status", "version", "createdAt", "updatedAt"
) VALUES
  ('permission:menu.lead_crm', 'menu.lead_crm', '线索销转', NULL, 'MENU', 'menu', 'view', 'LOW', '/leads', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:menu.customer', 'menu.customer', '客户管理', NULL, 'MENU', 'menu', 'view', 'LOW', '/customers', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:lead.read', 'lead.read', '查看线索', NULL, 'ACTION', 'lead', 'read', 'LOW', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:lead.create', 'lead.create', '创建线索', NULL, 'ACTION', 'lead', 'create', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:lead.update', 'lead.update', '修改线索', NULL, 'ACTION', 'lead', 'update', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:lead.assign', 'lead.assign', '分配线索', NULL, 'ACTION', 'lead', 'assign', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:lead.recycle', 'lead.recycle', '回收线索', NULL, 'ACTION', 'lead', 'recycle', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:lead.convert', 'lead.convert', '线索转客户', NULL, 'ACTION', 'lead', 'convert', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:lead.pool.claim', 'lead.pool.claim', '公海领取', NULL, 'ACTION', 'lead', 'pool.claim', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:appointment.read', 'appointment.read', '查看邀约', NULL, 'ACTION', 'appointment', 'read', 'LOW', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:appointment.create', 'appointment.create', '创建邀约', NULL, 'ACTION', 'appointment', 'create', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:appointment.visit', 'appointment.visit', '确认到访', NULL, 'ACTION', 'appointment', 'visit', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:customer.read', 'customer.read', '查看客户', NULL, 'ACTION', 'customer', 'read', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:customer.create', 'customer.create', '创建客户', NULL, 'ACTION', 'customer', 'create', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:customer.update', 'customer.update', '修改客户', NULL, 'ACTION', 'customer', 'update', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
