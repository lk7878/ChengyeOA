import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE ?? 'http://127.0.0.1:7001/api/v1';
const webBase = process.env.E2E_WEB_BASE ?? 'http://127.0.0.1:3000';
const adminToken = process.env.E2E_ADMIN_TOKEN ?? '';
const managerToken = process.env.E2E_MANAGER_TOKEN ?? '';
const managerUserId = process.env.E2E_MANAGER_USER_ID ?? '';
const rootOrganizationId = process.env.E2E_ROOT_ORGANIZATION_ID ?? '';
const artifactDirectory = path.resolve(process.cwd(), '../../../../docs/superpowers/reports/artifacts/spec-004');

test.setTimeout(90_000);

test('rehearses SPEC-004 authorization through real API and browser workflows', async ({ page, request }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  expect(adminToken, 'E2E_ADMIN_TOKEN is required').not.toBe('');
  expect(managerToken, 'E2E_MANAGER_TOKEN is required').not.toBe('');
  const admin = bearer(adminToken);
  const manager = bearer(managerToken);
  const suffix = Date.now().toString(36).toUpperCase();

  const chongqing = await post(request, '/organizations', { code: `CQ_${suffix}`, name: '重庆分所', type: 'BRANCH', parentId: rootOrganizationId }, admin);
  const beijing = await post(request, '/organizations', { code: `BJ_${suffix}`, name: '北京分所', type: 'BRANCH', parentId: rootOrganizationId }, admin);
  const cqPosition = await post(request, '/positions', { organizationId: chongqing.id, code: `LAWYER_CQ_${suffix}`, name: '律师', categoryCode: 'LAWYER', level: 1 }, admin);
  const bjPosition = await post(request, '/positions', { organizationId: beijing.id, code: `LAWYER_BJ_${suffix}`, name: '律师', categoryCode: 'LAWYER', level: 1 }, admin);
  const cqEmployee = await post(request, '/employees', { employeeNo: `CQ-${suffix}`, name: '重庆授权负责人', phone: '13800000000', idCard: '500000199001010000', employeeType: 'LAWYER', entryDate: '2026-07-19', primaryOrganizationId: chongqing.id, primaryPositionId: cqPosition.id }, admin);
  const bjTeamEmployee = await post(request, '/employees', { employeeNo: `BJT-${suffix}`, name: '北京医疗团队律师', phone: '13800000001', employeeType: 'LAWYER', entryDate: '2026-07-19', primaryOrganizationId: beijing.id, primaryPositionId: bjPosition.id }, admin);
  const bjHiddenEmployee = await post(request, '/employees', { employeeNo: `BJH-${suffix}`, name: '北京非团队律师', phone: '13800000002', employeeType: 'LAWYER', entryDate: '2026-07-19', primaryOrganizationId: beijing.id, primaryPositionId: bjPosition.id }, admin);
  await put(request, `/employees/${cqEmployee.id}/account-binding`, { userId: managerUserId, employeeVersion: cqEmployee.version }, admin);

  const team = await post(request, '/professional-teams', { code: `MEDICAL_${suffix}`, name: '跨分所医疗专业团队', categoryCode: 'MEDICAL', homeOrganizationId: rootOrganizationId }, admin);
  await post(request, `/professional-teams/${team.id}/members`, { employeeId: cqEmployee.id, memberRole: 'LEAD' }, admin);
  await post(request, `/professional-teams/${team.id}/members`, { employeeId: bjTeamEmployee.id, memberRole: 'LAWYER' }, admin);

  const branchScope = await post(request, '/permissions/data-scopes', { name: `重庆分所范围 ${suffix}`, scopeType: 'BRANCH', includeDescendants: true, organizationId: chongqing.id, professionalTeamId: null }, admin);
  const teamScope = await post(request, '/permissions/data-scopes', { name: `医疗团队范围 ${suffix}`, scopeType: 'TEAM', includeDescendants: false, organizationId: null, professionalTeamId: team.id }, admin);
  const beijingScope = await post(request, '/permissions/data-scopes', { name: `北京临时范围 ${suffix}`, scopeType: 'BRANCH', includeDescendants: true, organizationId: beijing.id, professionalTeamId: null }, admin);

  const branchRole = await createConfiguredRole(request, admin, `CQ_MANAGER_${suffix}`, '重庆分所负责人', ['menu.employee', 'menu.security_my_access', 'employee.read', 'employee.high_sensitive.read', 'permission.trace.self'], [{ resource: 'employee', dataScopeId: branchScope.id }]);
  await post(request, `/users/${managerUserId}/role-grants`, { roleId: branchRole.id, source: 'PERMANENT', validFrom: new Date(Date.now() - 1000).toISOString(), validUntil: null, reason: null }, admin);

  expect((await get(request, `/employees/${cqEmployee.id}`, manager)).phone).toBe('138****0000');
  await expectStatus(request, `/employees/${bjTeamEmployee.id}`, manager, 404);
  await expectStatus(request, `/employees/${bjHiddenEmployee.id}`, manager, 404);

  const teamRole = await createConfiguredRole(request, admin, `MEDICAL_TEAM_${suffix}`, '跨分所医疗团队成员', ['employee.read'], [{ resource: 'employee', dataScopeId: teamScope.id }]);
  await post(request, `/users/${managerUserId}/role-grants`, { roleId: teamRole.id, source: 'PERMANENT', validFrom: new Date(Date.now() - 1000).toISOString(), validUntil: null, reason: null }, admin);
  expect((await get(request, `/employees/${bjTeamEmployee.id}`, manager)).id).toBe(bjTeamEmployee.id);
  await expectStatus(request, `/employees/${bjHiddenEmployee.id}`, manager, 404);

  const temporaryRole = await createConfiguredRole(request, admin, `BJ_TEMP_${suffix}`, '北京临时查阅', ['employee.read'], [{ resource: 'employee', dataScopeId: beijingScope.id }]);
  const temporaryGrant = await post(request, `/users/${managerUserId}/role-grants`, { roleId: temporaryRole.id, source: 'TEMPORARY', validFrom: new Date(Date.now() - 1000).toISOString(), validUntil: new Date(Date.now() + 3500).toISOString(), reason: 'Court filing temporary cross-office review' }, admin);
  expect((await get(request, `/employees/${bjHiddenEmployee.id}`, manager)).id).toBe(bjHiddenEmployee.id);
  await expect.poll(async () => status(request, `/employees/${bjHiddenEmployee.id}`, manager), { timeout: 10_000 }).toBe(404);
  const expiredSummary = await get(request, `/users/${managerUserId}/authorization`, admin);
  expect(expiredSummary.roleGrants.find((grant: { id: string }) => grant.id === temporaryGrant.id).state).toBe('EXPIRED');
  await post(request, `/users/${managerUserId}/role-grants/${temporaryGrant.id}/revoke`, { reason: 'Temporary review completed and closed', version: temporaryGrant.version }, admin);
  const revokedSummary = await get(request, `/users/${managerUserId}/authorization`, admin);
  expect(revokedSummary.roleGrants.find((grant: { id: string }) => grant.id === temporaryGrant.id).state).toBe('REVOKED');

  const trace = await get(request, `/authorization/trace/users/${managerUserId}?permissionCode=employee.read`, admin);
  expect(trace.allowed).toBe(true);
  expect(new Set(trace.sources.flatMap((source: { scopeTypes: string[] }) => source.scopeTypes))).toEqual(new Set(['BRANCH', 'TEAM']));
  expect(JSON.stringify(trace)).not.toContain('13800000000');

  const sensitive = await post(request, '/authorization/sensitive-view', { resource: 'employee', resourceId: cqEmployee.id, fieldCodes: ['employee.idCard'], purpose: 'Verify identity for court filing' }, manager);
  expect(sensitive['employee.idCard']).toBe('500000199001010000');

  await mkdir(artifactDirectory, { recursive: true });
  await authenticate(page, adminToken, 'spec004-e2e-admin', 'spec004.e2e.admin');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${webBase}/security/roles`);
  await expect(page.getByText('重庆分所负责人')).toBeVisible();
  await page.screenshot({ path: path.join(artifactDirectory, 'roles-desktop.png'), fullPage: true });

  await page.goto(`${webBase}/security/trace`);
  await page.waitForTimeout(250);
  expect(pageErrors, `browser errors: ${pageErrors.join('\n')}`).toEqual([]);
  await expect(page.getByRole('heading', { name: '权限追踪' })).toBeVisible();
  await page.screenshot({ path: path.join(artifactDirectory, 'trace-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/security/users`);
  await expect(page.getByText('spec004.e2e.manager')).toBeVisible();
  await page.getByRole('button', { name: '管理 spec004.e2e.manager 的授权' }).click();
  await expect(page.getByText('重庆分所负责人')).toBeVisible();
  await page.screenshot({ path: path.join(artifactDirectory, 'user-grants-mobile.png'), fullPage: true });

  await authenticate(page, managerToken, managerUserId, 'spec004.e2e.manager');
  await page.goto(`${webBase}/org/employees`);
  const cqRow = page.getByRole('row').filter({ hasText: '重庆授权负责人' });
  await cqRow.locator('button').click();
  await page.getByRole('button', { name: '查看完整身份证号' }).click();
  await page.getByLabel('查看用途').fill('用于法院立案身份核验');
  await page.getByRole('button', { name: '确认查看' }).click();
  await expect(page.getByText('500000199001010000')).toBeVisible();
  await page.screenshot({ path: path.join(artifactDirectory, 'l4-purpose-mobile.png'), fullPage: true });
});

async function createConfiguredRole(request: APIRequestContext, headers: Record<string, string>, code: string, name: string, permissionCodes: string[], bindings: Array<{ resource: string; dataScopeId: string }>) {
  let role = await post(request, '/roles', { code, name, description: 'SPEC-004 E2E fixture' }, headers);
  role = await put(request, `/roles/${role.id}/permissions`, { permissionCodes, version: role.version }, headers);
  return put(request, `/roles/${role.id}/data-scopes`, { bindings, version: role.version }, headers);
}

async function authenticate(page: Page, token: string, userId: string, username: string) {
  await page.goto(`${webBase}/login`);
  await page.evaluate(({ accessToken, id, login }) => {
    localStorage.setItem('law_firm_token', accessToken);
    localStorage.setItem('auth-storage', JSON.stringify({ state: { token: accessToken, refreshToken: 'e2e', userInfo: { id, username: login, name: login }, isAuthenticated: true, authorization: null }, version: 0 }));
  }, { accessToken: token, id: userId, login: username });
}

function bearer(token: string) { return { Authorization: `Bearer ${token}` }; }

async function get(request: APIRequestContext, relativePath: string, headers: Record<string, string>) {
  const response = await request.get(`${apiBase}${relativePath}`, { headers });
  expect(response.ok(), `${relativePath}: ${await response.text()}`).toBe(true);
  return (await response.json()).data;
}

async function post(request: APIRequestContext, relativePath: string, data: unknown, headers: Record<string, string>) {
  const response = await request.post(`${apiBase}${relativePath}`, { data, headers });
  expect(response.ok(), `${relativePath}: ${await response.text()}`).toBe(true);
  return (await response.json()).data;
}

async function put(request: APIRequestContext, relativePath: string, data: unknown, headers: Record<string, string>) {
  const response = await request.put(`${apiBase}${relativePath}`, { data, headers });
  expect(response.ok(), `${relativePath}: ${await response.text()}`).toBe(true);
  return (await response.json()).data;
}

async function status(request: APIRequestContext, relativePath: string, headers: Record<string, string>) {
  return (await request.get(`${apiBase}${relativePath}`, { headers })).status();
}

async function expectStatus(request: APIRequestContext, relativePath: string, headers: Record<string, string>, expected: number) {
  expect(await status(request, relativePath, headers)).toBe(expected);
}
