$ErrorActionPreference = 'Stop'

$Database = 'chengye_oa_spec003_migration_test'
if ($Database -ne 'chengye_oa_spec003_migration_test') { throw 'Unsafe rehearsal database name' }

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

  Invoke-PsqlCommand $Database @'
INSERT INTO "organization" ("id", "name", "type", "parentId", "sort", "status", "updatedAt") VALUES
  ('root', 'Root Firm', 'FIRM', NULL, 0, 'ENABLED', CURRENT_TIMESTAMP),
  ('branch', 'Branch Office', 'BRANCH', 'root', 0, 'ENABLED', CURRENT_TIMESTAMP);
INSERT INTO "position" ("id", "name", "orgId", "level", "status", "updatedAt")
  VALUES ('position', 'Lawyer', 'branch', 1, 'ENABLED', CURRENT_TIMESTAMP);
INSERT INTO "employee" ("id", "employeeNo", "name", "phone", "type", "status", "entryDate", "orgId", "positionId", "updatedAt")
  VALUES ('employee', 'EMP-REHEARSAL', 'Migration Fixture', '13800000000', 'LAWYER', 'FORMAL', DATE '2026-01-01', 'branch', 'position', CURRENT_TIMESTAMP);
INSERT INTO "user" ("id", "username", "password", "status", "employeeId", "updatedAt")
  VALUES ('admin', 'migration.admin', 'non-production-fixture', 'ENABLED', 'employee', CURRENT_TIMESTAMP);
INSERT INTO "role" ("id", "name", "type", "description", "status", "code", "updatedAt")
  VALUES ('role', 'System Super Admin', 'SYSTEM', 'Migration fixture', 'ENABLED', 'SYSTEM_SUPER_ADMIN', CURRENT_TIMESTAMP);
INSERT INTO "user_role" ("id", "userId", "roleId") VALUES ('user-role', 'admin', 'role');
INSERT INTO "system_initialization" ("id", "version", "rootOrganizationId", "superAdminUserId", "completedAt")
  VALUES ('PRIMARY', 1, 'root', 'admin', CURRENT_TIMESTAMP);
'@

  Invoke-PsqlFile $Database '20260718120000_organization_personnel_expand\migration.sql'
  Invoke-PsqlFile $Database '20260718180000_employee_assignment_contract\migration.sql'

  Invoke-PsqlCommand $Database @'
DO $$
BEGIN
  IF (SELECT "path" FROM "organization" WHERE "id" = 'root') <> '/root' THEN
    RAISE EXCEPTION 'Root path rehearsal assertion failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "organization" WHERE "id" = 'branch' AND "path" = '/root/branch' AND "level" = 1) THEN
    RAISE EXCEPTION 'Branch path rehearsal assertion failed';
  END IF;
  IF (SELECT count(*) FROM "employee_assignment" WHERE "employeeId" = 'employee' AND "assignmentType" = 'PRIMARY' AND "endedAt" IS NULL) <> 1 THEN
    RAISE EXCEPTION 'Primary assignment rehearsal assertion failed';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee' AND column_name IN ('orgId', 'positionId')) THEN
    RAISE EXCEPTION 'Legacy employee ownership columns remain';
  END IF;
END $$;
'@

  Write-Output 'SPEC-003 migration rehearsal passed.'
}
finally {
  docker exec $Container psql -U $DbUser -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $Database WITH (FORCE);"
  if ($LASTEXITCODE -ne 0) { throw 'Failed to drop the disposable rehearsal database' }
}
