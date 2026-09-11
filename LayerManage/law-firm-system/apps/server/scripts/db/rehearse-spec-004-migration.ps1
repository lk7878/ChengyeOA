$ErrorActionPreference = 'Stop'

$Database = 'chengye_oa_spec004_migration_test'
if ($Database -ne 'chengye_oa_spec004_migration_test') { throw 'Unsafe rehearsal database name' }

$Container = 'chengye-oa-postgres'
$DbUser = 'chengye_app'
$MigrationRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\prisma\migrations')

function Invoke-PsqlCommand([string]$TargetDatabase, [string]$Sql) {
  $Sql | docker exec -i $Container psql -U $DbUser -d $TargetDatabase -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw "psql command failed for $TargetDatabase" }
}

function Invoke-PsqlFile([string]$TargetDatabase, [string]$RelativePath) {
  $Path = Join-Path $MigrationRoot $RelativePath
  Get-Content -LiteralPath $Path -Raw -Encoding utf8 | docker exec -i $Container psql -U $DbUser -d $TargetDatabase -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw "Migration failed: $RelativePath" }
}

try {
  Invoke-PsqlCommand 'postgres' "DROP DATABASE IF EXISTS $Database WITH (FORCE);"
  Invoke-PsqlCommand 'postgres' "CREATE DATABASE $Database;"

  Invoke-PsqlFile $Database '20260712232134_postgresql_baseline\migration.sql'
  Invoke-PsqlFile $Database '20260715120000_system_bootstrap_trust_root\migration.sql'
  Invoke-PsqlFile $Database '20260718120000_organization_personnel_expand\migration.sql'
  Invoke-PsqlFile $Database '20260718180000_employee_assignment_contract\migration.sql'

  Invoke-PsqlCommand $Database @'
INSERT INTO "organization" ("id", "code", "name", "type", "parentId", "path", "level", "sort", "status", "updatedAt") VALUES
  ('root', 'ROOT', 'Root Firm', 'FIRM', NULL, '/root', 0, 0, 'ENABLED', CURRENT_TIMESTAMP),
  ('branch', 'BRANCH', 'Branch Office', 'BRANCH', 'root', '/root/branch', 1, 0, 'ENABLED', CURRENT_TIMESTAMP);
INSERT INTO "user" ("id", "username", "password", "status", "updatedAt") VALUES
  ('admin', 'migration.admin', 'non-production-fixture', 'ENABLED', CURRENT_TIMESTAMP),
  ('business-user', 'migration.business', 'non-production-fixture', 'ENABLED', CURRENT_TIMESTAMP);
INSERT INTO "role" ("id", "name", "type", "description", "status", "code", "updatedAt") VALUES
  ('root-role', 'System Super Admin', 'SYSTEM', 'Migration fixture', 'ENABLED', 'SYSTEM_SUPER_ADMIN', CURRENT_TIMESTAMP),
  ('business-role', 'Historical Business Role', 'BUSINESS', 'Must survive migration', 'ENABLED', 'HISTORICAL_BUSINESS', CURRENT_TIMESTAMP);
INSERT INTO "user_role" ("id", "userId", "roleId") VALUES
  ('root-grant', 'admin', 'root-role'),
  ('business-grant', 'business-user', 'business-role');
INSERT INTO "permission" ("id", "code", "name", "type", "status", "createdAt")
  VALUES ('legacy-permission', 'legacy.unknown', 'Unknown historical permission', 'ACTION', 'ENABLED', CURRENT_TIMESTAMP);
INSERT INTO "role_permission" ("id", "roleId", "permissionId")
  VALUES ('legacy-role-permission', 'business-role', 'legacy-permission');
INSERT INTO "system_initialization" ("id", "version", "rootOrganizationId", "superAdminUserId", "completedAt")
  VALUES ('PRIMARY', 1, 'root', 'admin', CURRENT_TIMESTAMP);
'@

  Invoke-PsqlFile $Database '20260718210000_authorization_expand\migration.sql'
  Invoke-PsqlFile $Database '20260718220000_authorization_contract\migration.sql'

  Invoke-PsqlCommand $Database @'
DO $$
DECLARE
  model_table_count INTEGER;
BEGIN
  SELECT count(*) INTO model_table_count
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
  IF model_table_count <> 32 THEN
    RAISE EXCEPTION 'Expected 32 model tables, found %', model_table_count;
  END IF;

  IF (SELECT count(*) FROM "permission" WHERE "code" <> 'legacy.unknown') <> 61
    OR (SELECT count(DISTINCT "code") FROM "permission" WHERE "code" <> 'legacy.unknown') <> 61 THEN
    RAISE EXCEPTION 'Permission catalog codes are missing or duplicated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "system_initialization" initialization
    JOIN "user" root_user ON root_user."id" = initialization."superAdminUserId"
    JOIN "user_role" root_grant ON root_grant."userId" = root_user."id"
    JOIN "role" root_role ON root_role."id" = root_grant."roleId"
    WHERE initialization."id" = 'PRIMARY'
      AND root_user."id" = 'admin' AND root_user."username" = 'migration.admin'
      AND root_role."id" = 'root-role' AND root_role."code" = 'SYSTEM_SUPER_ADMIN'
      AND root_grant."id" = 'root-grant' AND root_grant."source" = 'PERMANENT'
      AND root_grant."validUntil" IS NULL AND root_grant."revokedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Trust root changed during migration';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "role" WHERE "id" = 'business-role' AND "code" = 'HISTORICAL_BUSINESS' AND "version" = 1) THEN
    RAISE EXCEPTION 'Historical business role did not survive';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "user_role" WHERE "id" = 'business-grant' AND "source" = 'PERMANENT' AND "validUntil" IS NULL AND "revokedAt" IS NULL) THEN
    RAISE EXCEPTION 'Historical UserRole was not converted to a permanent active grant';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "permission" WHERE "id" = 'legacy-permission' AND "code" = 'legacy.unknown' AND "status" = 'DISABLED' AND "resource" = 'legacy') THEN
    RAISE EXCEPTION 'Unknown historical permission was not retained as disabled';
  END IF;
  IF (SELECT count(*) FROM "data_scope") <> 0
    OR (SELECT count(*) FROM "user_permission_grant") <> 0
    OR (SELECT count(*) FROM "employee_reporting_line") <> 0 THEN
    RAISE EXCEPTION 'SPEC-004 migration synthesized scopes, special grants, or reporting lines';
  END IF;
  IF (SELECT count(*) FROM "role") <> 2 OR (SELECT count(*) FROM "user_role") <> 2 THEN
    RAISE EXCEPTION 'SPEC-004 migration synthesized or removed roles or grants';
  END IF;
END $$;
'@

  Write-Output 'SPEC-004 migration rehearsal passed.'
}
finally {
  docker exec $Container psql -U $DbUser -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $Database WITH (FORCE);"
  if ($LASTEXITCODE -ne 0) { throw 'Failed to drop the disposable rehearsal database' }
}
