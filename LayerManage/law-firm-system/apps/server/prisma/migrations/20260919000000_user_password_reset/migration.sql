-- Add the administrator-only password reset permission. Catalog entry only; existing roles, scopes and assignments are unchanged.
INSERT INTO "permission" ("id", "code", "name", "parentId", "type", "resource", "action", "riskLevel", "path", "sort", "status", "version", "createdAt", "updatedAt") VALUES
('permission:user.password.reset', 'user.password.reset', '重置用户密码', NULL, 'ACTION', 'user', 'password.reset', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
