CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "role"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "permission"
  ADD COLUMN "resource" TEXT,
  ADD COLUMN "action" TEXT,
  ADD COLUMN "riskLevel" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "user_role"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'PERMANENT',
  ADD COLUMN "validFrom" TIMESTAMPTZ(3),
  ADD COLUMN "validUntil" TIMESTAMPTZ(3),
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "grantedByUserId" TEXT,
  ADD COLUMN "revokedAt" TIMESTAMPTZ(3),
  ADD COLUMN "revokedByUserId" TEXT,
  ADD COLUMN "revokeReason" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "user_role"
SET "source" = 'PERMANENT',
    "validFrom" = "createdAt";

ALTER TABLE "user_role"
  ALTER COLUMN "validFrom" SET NOT NULL;

DROP INDEX "user_role_userId_roleId_key";
ALTER TABLE "user_role" DROP CONSTRAINT "user_role_userId_fkey";
ALTER TABLE "user_role" DROP CONSTRAINT "user_role_roleId_fkey";

UPDATE "permission"
SET "resource" = 'legacy',
    "action" = 'disabled',
    "type" = 'ACTION',
    "riskLevel" = 'HIGH',
    "status" = 'DISABLED';

CREATE TABLE "data_scope" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "scopeType" TEXT NOT NULL,
  "includeDescendants" BOOLEAN NOT NULL DEFAULT false,
  "organizationId" TEXT,
  "professionalTeamId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ENABLED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "data_scope_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_scope_target" (
  "id" TEXT NOT NULL,
  "dataScopeId" TEXT NOT NULL,
  "organizationId" TEXT,
  "professionalTeamId" TEXT,
  "employeeId" TEXT,
  CONSTRAINT "data_scope_target_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "role_data_scope" (
  "id" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "dataScopeId" TEXT NOT NULL,
  CONSTRAINT "role_data_scope_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "field_permission" (
  "id" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "fieldCode" TEXT NOT NULL,
  "readLevel" TEXT NOT NULL,
  "canWrite" BOOLEAN NOT NULL DEFAULT false,
  "canExport" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "field_permission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_permission_grant" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "permissionId" TEXT NOT NULL,
  "dataScopeId" TEXT NOT NULL,
  "validFrom" TIMESTAMPTZ(3) NOT NULL,
  "validUntil" TIMESTAMPTZ(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "grantedByUserId" TEXT NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "revokedByUserId" TEXT,
  "revokeReason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "user_permission_grant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employee_reporting_line" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "managerEmployeeId" TEXT NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "endedAt" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "employee_reporting_line_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "data_scope_scopeType_status_idx" ON "data_scope"("scopeType", "status");
CREATE INDEX "data_scope_target_dataScopeId_idx" ON "data_scope_target"("dataScopeId");
CREATE UNIQUE INDEX "data_scope_target_organization_unique" ON "data_scope_target"("dataScopeId", "organizationId") WHERE "organizationId" IS NOT NULL;
CREATE UNIQUE INDEX "data_scope_target_team_unique" ON "data_scope_target"("dataScopeId", "professionalTeamId") WHERE "professionalTeamId" IS NOT NULL;
CREATE UNIQUE INDEX "data_scope_target_employee_unique" ON "data_scope_target"("dataScopeId", "employeeId") WHERE "employeeId" IS NOT NULL;
CREATE UNIQUE INDEX "role_data_scope_roleId_resource_dataScopeId_key" ON "role_data_scope"("roleId", "resource", "dataScopeId");
CREATE INDEX "role_data_scope_roleId_resource_idx" ON "role_data_scope"("roleId", "resource");
CREATE UNIQUE INDEX "field_permission_roleId_resource_fieldCode_key" ON "field_permission"("roleId", "resource", "fieldCode");
CREATE INDEX "user_role_userId_validFrom_validUntil_idx" ON "user_role"("userId", "validFrom", "validUntil");
CREATE INDEX "user_role_roleId_validFrom_validUntil_idx" ON "user_role"("roleId", "validFrom", "validUntil");
CREATE INDEX "user_permission_grant_userId_validFrom_validUntil_idx" ON "user_permission_grant"("userId", "validFrom", "validUntil");
CREATE INDEX "employee_reporting_line_employeeId_endedAt_idx" ON "employee_reporting_line"("employeeId", "endedAt");
CREATE INDEX "employee_reporting_line_managerEmployeeId_endedAt_idx" ON "employee_reporting_line"("managerEmployeeId", "endedAt");
CREATE UNIQUE INDEX "employee_reporting_line_one_current_manager" ON "employee_reporting_line"("employeeId") WHERE "endedAt" IS NULL;

ALTER TABLE "role" ADD CONSTRAINT "role_version_positive" CHECK ("version" > 0);
ALTER TABLE "permission" ADD CONSTRAINT "permission_version_positive" CHECK ("version" > 0);
ALTER TABLE "permission" ADD CONSTRAINT "permission_type_check" CHECK ("type" IN ('MENU', 'ACTION', 'SPECIAL'));
ALTER TABLE "permission" ADD CONSTRAINT "permission_risk_level_check" CHECK ("riskLevel" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_source_check" CHECK ("source" IN ('PERMANENT', 'TEMPORARY'));
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_validity_check" CHECK (
  ("source" = 'PERMANENT' AND "validUntil" IS NULL)
  OR ("source" = 'TEMPORARY' AND "validUntil" IS NOT NULL AND "validUntil" > "validFrom")
);
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_revocation_check" CHECK (
  ("revokedAt" IS NULL AND "revokedByUserId" IS NULL AND "revokeReason" IS NULL)
  OR ("revokedAt" IS NOT NULL AND "revokedByUserId" IS NOT NULL AND length(btrim("revokeReason")) BETWEEN 10 AND 500)
);
ALTER TABLE "data_scope" ADD CONSTRAINT "data_scope_type_check" CHECK ("scopeType" IN ('ALL', 'HQ_SCOPE', 'ORG', 'BRANCH', 'TEAM', 'SELF_AND_SUBORDINATES', 'SELF', 'CUSTOM'));
ALTER TABLE "data_scope" ADD CONSTRAINT "data_scope_status_check" CHECK ("status" IN ('ENABLED', 'DISABLED'));
ALTER TABLE "data_scope" ADD CONSTRAINT "data_scope_version_positive" CHECK ("version" > 0);
ALTER TABLE "data_scope" ADD CONSTRAINT "data_scope_shape_check" CHECK (
  ("scopeType" IN ('ORG', 'BRANCH') AND "organizationId" IS NOT NULL AND "professionalTeamId" IS NULL)
  OR ("scopeType" = 'TEAM' AND "organizationId" IS NULL AND "professionalTeamId" IS NOT NULL)
  OR ("scopeType" IN ('ALL', 'HQ_SCOPE', 'SELF_AND_SUBORDINATES', 'SELF', 'CUSTOM') AND "organizationId" IS NULL AND "professionalTeamId" IS NULL)
);
ALTER TABLE "data_scope_target" ADD CONSTRAINT "data_scope_target_exactly_one_check" CHECK (
  num_nonnulls("organizationId", "professionalTeamId", "employeeId") = 1
);
ALTER TABLE "field_permission" ADD CONSTRAINT "field_permission_read_level_check" CHECK ("readLevel" IN ('NONE', 'MASKED', 'READ'));
ALTER TABLE "field_permission" ADD CONSTRAINT "field_permission_version_positive" CHECK ("version" > 0);
ALTER TABLE "user_permission_grant" ADD CONSTRAINT "user_permission_grant_validity_check" CHECK ("validUntil" > "validFrom");
ALTER TABLE "user_permission_grant" ADD CONSTRAINT "user_permission_grant_duration_check" CHECK ("validUntil" <= "validFrom" + INTERVAL '30 days');
ALTER TABLE "user_permission_grant" ADD CONSTRAINT "user_permission_grant_reason_check" CHECK (length(btrim("reason")) BETWEEN 10 AND 500);
ALTER TABLE "user_permission_grant" ADD CONSTRAINT "user_permission_grant_revocation_check" CHECK (
  ("revokedAt" IS NULL AND "revokedByUserId" IS NULL AND "revokeReason" IS NULL)
  OR ("revokedAt" IS NOT NULL AND "revokedByUserId" IS NOT NULL AND length(btrim("revokeReason")) BETWEEN 10 AND 500)
);
ALTER TABLE "employee_reporting_line" ADD CONSTRAINT "employee_reporting_line_no_self_manager" CHECK ("employeeId" <> "managerEmployeeId");
ALTER TABLE "employee_reporting_line" ADD CONSTRAINT "employee_reporting_line_date_order_check" CHECK ("endedAt" IS NULL OR "endedAt" > "startedAt");
ALTER TABLE "employee_reporting_line" ADD CONSTRAINT "employee_reporting_line_version_positive" CHECK ("version" > 0);

ALTER TABLE "user_role" ADD CONSTRAINT "user_role_no_overlapping_active_grants"
  EXCLUDE USING gist (
    "userId" WITH =,
    "roleId" WITH =,
    tstzrange("validFrom", COALESCE("validUntil", 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE ("revokedAt" IS NULL);

ALTER TABLE "user_permission_grant" ADD CONSTRAINT "user_permission_grant_no_overlap"
  EXCLUDE USING gist (
    "userId" WITH =,
    "permissionId" WITH =,
    "dataScopeId" WITH =,
    tstzrange("validFrom", "validUntil", '[)') WITH &&
  ) WHERE ("revokedAt" IS NULL);

ALTER TABLE "user_role" ADD CONSTRAINT "user_role_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_scope" ADD CONSTRAINT "data_scope_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_scope" ADD CONSTRAINT "data_scope_professionalTeamId_fkey" FOREIGN KEY ("professionalTeamId") REFERENCES "professional_team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_scope_target" ADD CONSTRAINT "data_scope_target_dataScopeId_fkey" FOREIGN KEY ("dataScopeId") REFERENCES "data_scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_scope_target" ADD CONSTRAINT "data_scope_target_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_scope_target" ADD CONSTRAINT "data_scope_target_professionalTeamId_fkey" FOREIGN KEY ("professionalTeamId") REFERENCES "professional_team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_scope_target" ADD CONSTRAINT "data_scope_target_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_data_scope" ADD CONSTRAINT "role_data_scope_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_data_scope" ADD CONSTRAINT "role_data_scope_dataScopeId_fkey" FOREIGN KEY ("dataScopeId") REFERENCES "data_scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "field_permission" ADD CONSTRAINT "field_permission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_permission_grant" ADD CONSTRAINT "user_permission_grant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_permission_grant" ADD CONSTRAINT "user_permission_grant_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_permission_grant" ADD CONSTRAINT "user_permission_grant_dataScopeId_fkey" FOREIGN KEY ("dataScopeId") REFERENCES "data_scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_permission_grant" ADD CONSTRAINT "user_permission_grant_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_permission_grant" ADD CONSTRAINT "user_permission_grant_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_reporting_line" ADD CONSTRAINT "employee_reporting_line_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_reporting_line" ADD CONSTRAINT "employee_reporting_line_managerEmployeeId_fkey" FOREIGN KEY ("managerEmployeeId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permission" (
  "id", "code", "name", "parentId", "type", "resource", "action", "riskLevel", "path", "sort", "status", "version", "createdAt", "updatedAt"
) VALUES
  ('permission:menu.organization_personnel', 'menu.organization_personnel', '组织与人员', NULL, 'MENU', 'menu', 'view', 'LOW', '/organization-personnel', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:menu.organization', 'menu.organization', '组织管理', NULL, 'MENU', 'menu', 'view', 'LOW', '/organizations', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:menu.position', 'menu.position', '岗位管理', NULL, 'MENU', 'menu', 'view', 'LOW', '/positions', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:menu.employee', 'menu.employee', '员工管理', NULL, 'MENU', 'menu', 'view', 'LOW', '/employees', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:menu.professional_team', 'menu.professional_team', '专业团队', NULL, 'MENU', 'menu', 'view', 'LOW', '/professional-teams', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:menu.security_my_access', 'menu.security_my_access', '我的权限', NULL, 'MENU', 'menu', 'view', 'LOW', '/security/my-access', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:menu.security_roles', 'menu.security_roles', '角色权限', NULL, 'MENU', 'menu', 'view', 'MEDIUM', '/security/roles', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:menu.security_users', 'menu.security_users', '用户授权', NULL, 'MENU', 'menu', 'view', 'MEDIUM', '/security/users', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:menu.security_trace', 'menu.security_trace', '权限追踪', NULL, 'MENU', 'menu', 'view', 'HIGH', '/security/trace', 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:organization.read', 'organization.read', '查看组织', NULL, 'ACTION', 'organization', 'read', 'LOW', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:organization.create', 'organization.create', '创建组织', NULL, 'ACTION', 'organization', 'create', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:organization.update', 'organization.update', '修改组织', NULL, 'ACTION', 'organization', 'update', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:organization.move', 'organization.move', '移动组织', NULL, 'ACTION', 'organization', 'move', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:organization.status.manage', 'organization.status.manage', '管理组织状态', NULL, 'ACTION', 'organization', 'status.manage', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:position.read', 'position.read', '查看岗位', NULL, 'ACTION', 'position', 'read', 'LOW', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:position.create', 'position.create', '创建岗位', NULL, 'ACTION', 'position', 'create', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:position.update', 'position.update', '修改岗位', NULL, 'ACTION', 'position', 'update', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:position.status.manage', 'position.status.manage', '管理岗位状态', NULL, 'ACTION', 'position', 'status.manage', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:employee.read', 'employee.read', '查看员工', NULL, 'ACTION', 'employee', 'read', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:employee.create', 'employee.create', '创建员工', NULL, 'ACTION', 'employee', 'create', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:employee.update', 'employee.update', '修改员工', NULL, 'ACTION', 'employee', 'update', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:employee.formalize', 'employee.formalize', '员工转正', NULL, 'ACTION', 'employee', 'formalize', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:employee.leave', 'employee.leave', '员工离职', NULL, 'ACTION', 'employee', 'leave', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:employee.assignment.read', 'employee.assignment.read', '查看任职', NULL, 'ACTION', 'employee_assignment', 'read', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:employee.assignment.manage', 'employee.assignment.manage', '管理任职', NULL, 'ACTION', 'employee_assignment', 'manage', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:employee.reporting_line.read', 'employee.reporting_line.read', '查看汇报关系', NULL, 'ACTION', 'employee_reporting_line', 'read', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:employee.reporting_line.manage', 'employee.reporting_line.manage', '管理汇报关系', NULL, 'ACTION', 'employee_reporting_line', 'manage', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:employee.account_binding.read', 'employee.account_binding.read', '查看账号绑定', NULL, 'ACTION', 'employee_account_binding', 'read', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:employee.account_binding.manage', 'employee.account_binding.manage', '管理员工账号绑定', NULL, 'ACTION', 'employee_account_binding', 'manage', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:professional_team.read', 'professional_team.read', '查看专业团队', NULL, 'ACTION', 'professional_team', 'read', 'LOW', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:professional_team.create', 'professional_team.create', '创建专业团队', NULL, 'ACTION', 'professional_team', 'create', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:professional_team.update', 'professional_team.update', '修改专业团队', NULL, 'ACTION', 'professional_team', 'update', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:professional_team.status.manage', 'professional_team.status.manage', '管理专业团队状态', NULL, 'ACTION', 'professional_team', 'status.manage', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:professional_team.member.manage', 'professional_team.member.manage', '管理专业团队成员', NULL, 'ACTION', 'professional_team', 'member.manage', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:professional_team.lead.manage', 'professional_team.lead.manage', '管理专业团队负责人', NULL, 'ACTION', 'professional_team', 'lead.manage', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:user.read', 'user.read', '查看用户', NULL, 'ACTION', 'user', 'read', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:user.create', 'user.create', '创建用户', NULL, 'ACTION', 'user', 'create', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:user.update', 'user.update', '修改用户', NULL, 'ACTION', 'user', 'update', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:user.status.manage', 'user.status.manage', '管理用户状态', NULL, 'ACTION', 'user', 'status.manage', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:role.read', 'role.read', '查看角色', NULL, 'ACTION', 'role', 'read', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:role.create', 'role.create', '创建角色', NULL, 'ACTION', 'role', 'create', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:role.update', 'role.update', '修改角色', NULL, 'ACTION', 'role', 'update', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:role.status.manage', 'role.status.manage', '管理角色状态', NULL, 'ACTION', 'role', 'status.manage', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:role.permission.manage', 'role.permission.manage', '管理角色权限', NULL, 'SPECIAL', 'role', 'permission.manage', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:user.role.manage', 'user.role.manage', '管理用户角色', NULL, 'SPECIAL', 'user_role', 'manage', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:permission.catalog.read', 'permission.catalog.read', '查看权限目录', NULL, 'ACTION', 'permission', 'catalog.read', 'MEDIUM', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:permission.trace.self', 'permission.trace.self', '追踪本人权限', NULL, 'ACTION', 'permission', 'trace.self', 'LOW', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:permission.trace.any', 'permission.trace.any', '追踪任意用户权限', NULL, 'SPECIAL', 'permission', 'trace.any', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:temporary_grant.manage', 'temporary_grant.manage', '管理临时授权', NULL, 'SPECIAL', 'temporary_grant', 'manage', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:employee.sensitive.read', 'employee.sensitive.read', '查看员工敏感信息原文', NULL, 'SPECIAL', 'employee', 'sensitive.read', 'HIGH', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:employee.high_sensitive.read', 'employee.high_sensitive.read', '查看员工高敏信息原文', NULL, 'SPECIAL', 'employee', 'high_sensitive.read', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:employee.sensitive.export', 'employee.sensitive.export', '导出员工敏感信息', NULL, 'SPECIAL', 'employee', 'sensitive.export', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:customer.merge', 'customer.merge', '合并客户', NULL, 'SPECIAL', 'customer', 'merge', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:contract.void', 'contract.void', '作废合同', NULL, 'SPECIAL', 'contract', 'void', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:payment.confirm', 'payment.confirm', '确认收款', NULL, 'SPECIAL', 'payment', 'confirm', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:refund.approve', 'refund.approve', '审批退款', NULL, 'SPECIAL', 'refund', 'approve', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:matter.intervene', 'matter.intervene', '干预案件', NULL, 'SPECIAL', 'matter', 'intervene', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:file.sensitive.download', 'file.sensitive.download', '下载敏感文件', NULL, 'SPECIAL', 'file', 'sensitive.download', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:data.bulk_export', 'data.bulk_export', '批量导出数据', NULL, 'SPECIAL', 'data', 'bulk_export', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:config.publish', 'config.publish', '发布系统配置', NULL, 'SPECIAL', 'config', 'publish', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('permission:config.high_risk.change', 'config.high_risk.change', '修改高风险配置', NULL, 'SPECIAL', 'config', 'high_risk.change', 'CRITICAL', NULL, 0, 'ENABLED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "id" = EXCLUDED."id",
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "type" = EXCLUDED."type",
  "resource" = EXCLUDED."resource",
  "action" = EXCLUDED."action",
  "riskLevel" = EXCLUDED."riskLevel",
  "path" = EXCLUDED."path",
  "sort" = EXCLUDED."sort",
  "status" = EXCLUDED."status",
  "version" = "permission"."version" + 1,
  "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "permission"
  ALTER COLUMN "resource" SET NOT NULL,
  ALTER COLUMN "action" SET NOT NULL,
  ALTER COLUMN "riskLevel" SET NOT NULL;
