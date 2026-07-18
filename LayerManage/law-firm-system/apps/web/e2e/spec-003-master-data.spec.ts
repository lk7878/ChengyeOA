import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE ?? 'http://127.0.0.1:7001/api/v1';
const webBase = process.env.E2E_WEB_BASE ?? 'http://127.0.0.1:3000';
const token = process.env.E2E_ACCESS_TOKEN ?? '';
const artifactDirectory = path.resolve(process.cwd(), '../../../../docs/superpowers/reports/artifacts/spec-003');

test('super-admin completes the SPEC-003 master-data flow', async ({ page, request }) => {
  expect(token, 'E2E_ACCESS_TOKEN must be prepared before the test').not.toBe('');
  const headers = { Authorization: `Bearer ${token}` };
  const rootId = await findRoot(request, headers);
  const suffix = Date.now().toString(36).toUpperCase();
  const employeeName = `测试律师-${suffix}`;
  const teamName = `医疗纠纷团队-${suffix}`;
  const shanghai = await post(request, '/organizations', { code: `SH_${suffix}`, name: '上海分所', type: 'BRANCH', parentId: rootId }, headers);
  const beijing = await post(request, '/organizations', { code: `BJ_${suffix}`, name: '北京分所', type: 'BRANCH', parentId: rootId }, headers);
  const shanghaiPosition = await post(request, '/positions', { organizationId: shanghai.id, code: `LAWYER_${suffix}`, name: '律师', categoryCode: 'LAWYER', level: 1 }, headers);
  const beijingPosition = await post(request, '/positions', { organizationId: beijing.id, code: `LAWYER_${suffix}`, name: '律师', categoryCode: 'LAWYER', level: 1 }, headers);
  const employee = await post(request, '/employees', { employeeNo: `EMP-${suffix}`, name: employeeName, phone: '13800000000', employeeType: 'LAWYER', entryDate: '2026-07-18', primaryOrganizationId: shanghai.id, primaryPositionId: shanghaiPosition.id }, headers);
  const transferred = await post(request, `/employees/${employee.id}/assignments/transfer`, { organizationId: beijing.id, positionId: beijingPosition.id, employeeVersion: employee.version }, headers);
  const team = await post(request, '/professional-teams', { code: `MEDICAL_${suffix}`, name: teamName, categoryCode: 'MEDICAL', homeOrganizationId: rootId }, headers);
  await post(request, `/professional-teams/${team.id}/members`, { employeeId: employee.id, memberRole: 'LEAD' }, headers);
  expect(transferred.primaryAssignment.organizationId).toBe(beijing.id);

  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${webBase}/org/employees`);
  const employeeRow = page.getByRole('row').filter({ hasText: employeeName });
  await expect(employeeRow).toContainText('北京分所');
  await expect(employeeRow).toContainText(teamName);
  await mkdir(artifactDirectory, { recursive: true });
  await page.screenshot({ path: path.join(artifactDirectory, 'employees-desktop.png'), fullPage: true });

  await page.goto(`${webBase}/org/professional-teams`);
  await expect(page.getByText(teamName)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(artifactDirectory, 'professional-teams-mobile.png'), fullPage: true });
});

async function authenticate(page: Page) {
  await page.goto(`${webBase}/login`);
  await page.evaluate(({ accessToken }) => {
    localStorage.setItem('law_firm_token', accessToken);
    localStorage.setItem('auth-storage', JSON.stringify({ state: { token: accessToken, refreshToken: 'e2e', userInfo: { id: 'e2e-admin', username: 'e2e.admin', name: 'E2E 管理员', roles: ['SYSTEM_SUPER_ADMIN'], permissions: [] }, isAuthenticated: true }, version: 0 }));
  }, { accessToken: token });
}

async function findRoot(request: APIRequestContext, headers: Record<string, string>): Promise<string> {
  const response = await request.get(`${apiBase}/organizations/tree`, { headers });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  return body.data[0].id;
}

async function post(request: APIRequestContext, relativePath: string, data: unknown, headers: Record<string, string>) {
  const response = await request.post(`${apiBase}${relativePath}`, { data, headers });
  expect(response.ok(), `${relativePath}: ${await response.text()}`).toBe(true);
  return (await response.json()).data;
}
