-- Insert catalog entries only; existing roles, scopes and assignments remain unchanged.
INSERT INTO "permission" ("id", "code", "name", "parentId", "type", "resource", "action", "riskLevel", "path", "sort", "status", "version", "createdAt", "updatedAt") VALUES
('permission:menu.channel', 'menu.channel', '渠道管理', NULL, 'MENU', 'menu', 'view', 'LOW', '/channels', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('permission:channel.read', 'channel.read', '查看渠道', NULL, 'ACTION', 'channel', 'read', 'LOW', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('permission:channel.create', 'channel.create', '登记渠道', NULL, 'ACTION', 'channel', 'create', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('permission:channel.update', 'channel.update', '编辑渠道', NULL, 'ACTION', 'channel', 'update', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('permission:channel.delete', 'channel.delete', '删除渠道', NULL, 'ACTION', 'channel', 'delete', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
