INSERT INTO "permission" ("id", "code", "name", "type", "resource", "action", "riskLevel", "status", "version", "createdAt", "updatedAt")
VALUES ('permission:position.delete', 'position.delete', '删除岗位（保留任职历史）', 'ACTION', 'position', 'delete', 'HIGH', 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
