import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const routerSource = fs.readFileSync(path.resolve(__dirname, '../../app/router.ts'), 'utf8');
const configSource = fs.readFileSync(path.resolve(__dirname, '../../config/config.default.ts'), 'utf8');
const legacyGatePath = path.resolve(__dirname, '../../app/middleware/masterDataAccess.ts');

const protectedRoutes = [
  ['get', '/api/v1/authorization/me/trace', 'permission.trace.self'],
  ['post', '/api/v1/authorization/sensitive-view', 'employee.high_sensitive.read'],
  ['get', '/api/v1/permissions/catalog', 'permission.catalog.read'],
  ['get', '/api/v1/permissions/fields', 'role.permission.manage'],
  ['get', '/api/v1/permissions/data-scopes', 'role.permission.manage'],
  ['post', '/api/v1/permissions/data-scopes', 'role.permission.manage'],
  ['get', '/api/v1/roles', 'role.read'],
  ['get', '/api/v1/roles/:id', 'role.read'],
  ['post', '/api/v1/roles', 'role.create'],
  ['patch', '/api/v1/roles/:id', 'role.update'],
  ['post', '/api/v1/roles/:id/disable', 'role.status.manage'],
  ['post', '/api/v1/roles/:id/enable', 'role.status.manage'],
  ['put', '/api/v1/roles/:id/permissions', 'role.permission.manage'],
  ['put', '/api/v1/roles/:id/data-scopes', 'role.permission.manage'],
  ['put', '/api/v1/roles/:id/field-permissions', 'role.permission.manage'],
  ['get', '/api/v1/users', 'user.read'],
  ['get', '/api/v1/users/:id', 'user.read'],
  ['post', '/api/v1/users', 'user.create'],
  ['put', '/api/v1/users/:id', 'user.update'],
  ['delete', '/api/v1/users/:id', 'user.status.manage'],
  ['get', '/api/v1/users/:id/authorization', 'user.read'],
  ['post', '/api/v1/users/:id/special-grants', 'temporary_grant.manage'],
  ['post', '/api/v1/users/:id/special-grants/:grantId/revoke', 'temporary_grant.manage'],
  ['get', '/api/v1/authorization/trace/users/:id', 'permission.trace.any'],
  ['get', '/api/v1/employees/:id/reporting-lines', 'employee.reporting_line.read'],
  ['post', '/api/v1/employees/:id/reporting-lines', 'employee.reporting_line.manage'],
  ['post', '/api/v1/employees/:id/reporting-lines/:lineId/end', 'employee.reporting_line.manage'],
  ['get', '/api/v1/organizations/tree', 'organization.read'],
  ['get', '/api/v1/organizations/:id', 'organization.read'],
  ['post', '/api/v1/organizations', 'organization.create'],
  ['patch', '/api/v1/organizations/:id', 'organization.update'],
  ['post', '/api/v1/organizations/:id/move', 'organization.move'],
  ['post', '/api/v1/organizations/:id/disable', 'organization.status.manage'],
  ['post', '/api/v1/organizations/:id/enable', 'organization.status.manage'],
  ['get', '/api/v1/positions', 'position.read'],
  ['get', '/api/v1/positions/:id', 'position.read'],
  ['post', '/api/v1/positions', 'position.create'],
  ['patch', '/api/v1/positions/:id', 'position.update'],
  ['post', '/api/v1/positions/:id/disable', 'position.status.manage'],
  ['post', '/api/v1/positions/:id/enable', 'position.status.manage'],
  ['get', '/api/v1/employees', 'employee.read'],
  ['get', '/api/v1/employees/:id', 'employee.read'],
  ['post', '/api/v1/employees', 'employee.create'],
  ['patch', '/api/v1/employees/:id', 'employee.update'],
  ['post', '/api/v1/employees/:id/formalize', 'employee.formalize'],
  ['post', '/api/v1/employees/:id/leave', 'employee.leave'],
  ['post', '/api/v1/employees/:id/assignments/transfer', 'employee.assignment.manage'],
  ['post', '/api/v1/employees/:id/assignments', 'employee.assignment.manage'],
  ['post', '/api/v1/employees/:id/assignments/:assignmentId/end', 'employee.assignment.manage'],
  ['put', '/api/v1/employees/:id/account-binding', 'employee.account_binding.manage'],
  ['delete', '/api/v1/employees/:id/account-binding', 'employee.account_binding.manage'],
  ['get', '/api/v1/professional-teams', 'professional_team.read'],
  ['get', '/api/v1/professional-teams/:id', 'professional_team.read'],
  ['post', '/api/v1/professional-teams', 'professional_team.create'],
  ['patch', '/api/v1/professional-teams/:id', 'professional_team.update'],
  ['post', '/api/v1/professional-teams/:id/disable', 'professional_team.status.manage'],
  ['post', '/api/v1/professional-teams/:id/enable', 'professional_team.status.manage'],
  ['post', '/api/v1/professional-teams/:id/members', 'professional_team.member.manage'],
  ['post', '/api/v1/professional-teams/:id/members/:memberId/end', 'professional_team.member.manage'],
  ['post', '/api/v1/professional-teams/:id/lead', 'professional_team.lead.manage'],
] as const;

test('registers every SPEC-004 authorization route with explicit permission metadata', () => {
  for (const [method, route, permission] of protectedRoutes) {
    const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const organizationGate = route.startsWith('/api/v1/organizations') ? 'requireOrganizationSuperAdmin,\\s*' : '';
    const pattern = new RegExp(
      `router\\.${method}\\(\\s*['"]${escapedRoute}['"]\\s*,\\s*${organizationGate}requirePermission\\(['"]${permission}['"]\\)`,
    );
    assert.match(routerSource, pattern, `${method.toUpperCase()} ${route} must require ${permission}`);
  }
});

// SPEC-015 follow-up（业务角色成员指派）：role-grants 两个端点改为任一码门控
// （治理码 user.role.manage 或委派码 user_role.membership.manage）——从 protectedRoutes
// 单码断言移出，单独断言 requireAnyPermission 双码。
test('role-grant routes use requireAnyPermission for delegable role membership management', () => {
  for (const route of ['/api/v1/users/:id/role-grants', '/api/v1/users/:id/role-grants/:grantId/revoke']) {
    const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      routerSource,
      new RegExp(`router\\.post\\(\\s*['"]${escapedRoute}['"]\\s*,\\s*requireAnyPermission\\(\\[\\s*['"]user\\.role\\.manage['"]\\s*,\\s*['"]user_role\\.membership\\.manage['"]\\s*\\]\\)`),
      `${route} must use requireAnyPermission(['user.role.manage', 'user_role.membership.manage'])`,
    );
  }
});

test('removes physical role deletion and history-destroying replacement routes', () => {
  assert.doesNotMatch(routerSource, /router\.delete\(\s*['"]\/api\/v1\/roles\/:id['"]/);
  assert.doesNotMatch(routerSource, /router\.post\(\s*['"]\/api\/v1\/users\/:id\/roles['"]/);
  assert.doesNotMatch(routerSource, /router\.post\(\s*['"]\/api\/v1\/roles\/:id\/permissions['"]/);
});

test('keeps the current-user authorization summary authenticated without a circular permission gate', () => {
  assert.match(routerSource, /router\.get\(\s*['"]\/api\/v1\/authorization\/me['"]\s*,\s*controller\.authorization\.me\s*\)/);
});

test('removes the temporary master-data gate after formal authorization coverage', () => {
  assert.equal(fs.existsSync(legacyGatePath), false);
  assert.match(
    configSource,
    /config\.middleware\s*=\s*\['errorHandler', 'csrf', 'auth', 'authorizationContext', 'administratorMfaGuard'\]/,
  );
  assert.doesNotMatch(configSource, /masterDataAccess/);
});
