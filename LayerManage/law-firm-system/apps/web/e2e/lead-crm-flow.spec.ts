// SPEC-009 Task 11: 线索销转全链路 E2E 排练（形态对齐 e2e/spec-003、spec-004）。
// 链路：登录 → 创建线索 → 公海领取 → 跟进 → 状态流转→SCREENED → 创建邀约 → 确认到访 → 转客户。
// 环境驱动（无 playwright.config / 无 e2e npm script，需外部已运行栈 7001+3000）：
//   E2E_API_BASE      默认 http://127.0.0.1:7001/api/v1
//   E2E_WEB_BASE      默认 http://127.0.0.1:3000
//   E2E_ADMIN_USERNAME 预置全权限账号（需 menu.lead_crm/menu.customer + lead.*/appointment.*/customer.* + ALL 数据范围 + L3 明文；
//                      且必须绑定员工（User.employeeId），否则公海领取 403 ACTOR_EMPLOYEE_UNBOUND）
//   E2E_ADMIN_PASSWORD 对应密码（账号须直达 AUTHENTICATED，无 MFA/强制改密挑战）
// 截图 artifacts 落 docs/superpowers/reports/artifacts/lead-crm/。
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE ?? 'http://127.0.0.1:7001/api/v1';
const webBase = process.env.E2E_WEB_BASE ?? 'http://127.0.0.1:3000';
const username = process.env.E2E_ADMIN_USERNAME ?? '';
const password = process.env.E2E_ADMIN_PASSWORD ?? '';
const artifactDirectory = path.resolve(process.cwd(), '../../../../docs/superpowers/reports/artifacts/lead-crm');

test.setTimeout(180_000);

test('completes the lead-to-customer CRM flow on desktop and mobile viewports', async ({ page, request }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  expect(username, 'E2E_ADMIN_USERNAME is required').not.toBe('');
  expect(password, 'E2E_ADMIN_PASSWORD is required').not.toBe('');

  const suffix = Date.now().toString(36).toUpperCase();
  const leadName = `E2E线索${suffix}`;
  const leadPhone = `139${String(Date.now()).slice(-8)}`;
  const followContent = `E2E 跟进记录 ${suffix}`;
  const appointmentTime = futureSlot();

  // ===== 步骤 1：登录（真实登录页 UI）=====
  await page.goto(`${webBase}/login`);
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await page.waitForURL(`${webBase}/`, { timeout: 30_000 });
  await expect(page.getByText('线索销转')).toBeVisible();

  // ===== 步骤 2：创建线索 =====
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${webBase}/leads`);
  await page.getByRole('button', { name: /新建线索/ }).click();
  const createDialog = page.getByRole('dialog');
  await createDialog.locator('#name').fill(leadName);
  await createDialog.locator('#phone').fill(leadPhone);
  await createDialog.getByRole('button', { name: /确\s*定/ }).click();
  // 创建成功或疑似重复提示均为可接受终态；重复提示需手动关闭。
  const duplicateDialog = page.getByRole('dialog').filter({ hasText: '已创建，但存在疑似重复线索' });
  if (await duplicateDialog.isVisible().catch(() => false)) {
    await duplicateDialog.getByRole('button', { name: /确\s*定/ }).click();
  }
  await searchLead(page, leadName);
  await expect(page.getByRole('row').filter({ hasText: leadName }).first()).toBeVisible();
  await mkdir(artifactDirectory, { recursive: true });
  await page.screenshot({ path: path.join(artifactDirectory, 'leads-list-desktop.png'), fullPage: true });

  // ===== 步骤 3：公海领取 =====
  await page.goto(`${webBase}/leads/pool`);
  await page.getByPlaceholder('搜索姓名/电话/编号').fill(leadName);
  await page.getByRole('button', { name: /搜\s*索/ }).click();
  const poolRow = page.getByRole('row').filter({ hasText: leadName }).first();
  await expect(poolRow).toBeVisible();
  await poolRow.getByRole('button', { name: /领取/ }).click();
  await page.getByRole('button', { name: /确\s*定/ }).click();
  await expect(page.getByText('领取成功，线索已转入你的私海')).toBeVisible();
  await page.screenshot({ path: path.join(artifactDirectory, 'pool-desktop.png'), fullPage: true });

  // ===== 步骤 4：跟进 =====
  await page.goto(`${webBase}/leads`);
  await searchLead(page, leadName);
  await page.getByRole('row').filter({ hasText: leadName }).first().getByRole('button', { name: '详情' }).click();
  await page.waitForURL(/\/leads\/[^/]+$/);
  const leadId = page.url().split('/leads/')[1];
  await page.getByRole('button', { name: /添加跟进/ }).click();
  const followDialog = page.getByRole('dialog');
  await followDialog.locator('#content').fill(followContent);
  await followDialog.getByRole('button', { name: /确\s*定/ }).click();
  await expect(page.getByText(followContent)).toBeVisible();

  // ===== 步骤 5：状态流转 → SCREENED（API PATCH；状态机必经环节，设计 §6.3 主链第 4 步）=====
  // lead-policy.ts 箭头表：CONTACTED→SCREENED→INVITED→VISITED→CONVERTED。跟进已推进
  // ASSIGNED→CONTACTED；创建邀约仅在 lead=SCREENED 时才推进 INVITED（CONTACTED 直接
  // 邀约不推进 lead），确认到访仅在 INVITED 时推进 VISITED——缺本步则转客户时 lead
  // 仍 CONTACTED，撞 VISITED→CONVERTED 前置（409 LEAD_STATE_TRANSITION_INVALID）。
  const token = await apiLogin();
  const transitionResponse = await request.patch(`${apiBase}/leads/${leadId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { targetStatus: 'SCREENED', reason: 'E2E 初筛通过' },
  });
  expect(
    transitionResponse.ok(),
    `PATCH /leads/${leadId} → SCREENED: ${await transitionResponse.text()}`,
  ).toBe(true);

  // ===== 步骤 6：创建邀约 =====
  await page.getByRole('button', { name: /发起邀约/ }).click();
  const appointmentDialog = page.getByRole('dialog');
  await appointmentDialog.getByPlaceholder('选择邀约时间').click();
  await appointmentDialog.getByPlaceholder('选择邀约时间').fill(appointmentTime);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await appointmentDialog.getByRole('button', { name: /确\s*定/ }).click();
  await expect(page.getByText('邀约已创建')).toBeVisible();
  await expect(page.getByText(appointmentTime.slice(0, 10))).toBeVisible();

  // ===== 步骤 7：确认到访 =====
  await page.getByRole('button', { name: '确认到访' }).first().click();
  await page.getByRole('button', { name: /确\s*定/ }).click();
  await expect(page.getByText('已确认到访')).toBeVisible();
  await page.screenshot({ path: path.join(artifactDirectory, 'lead-detail-desktop.png'), fullPage: true });

  // ===== 步骤 8：转客户 =====
  await page.getByRole('button', { name: /转客户/ }).click();
  const convertDialog = page.getByRole('dialog');
  // 预填来自线索明文；显式补齐确保必填（全权限账号 L3 明文可读）。
  await convertDialog.locator('#customer_name').fill(leadName);
  await convertDialog.locator('#customer_phone').fill(leadPhone);
  await convertDialog.locator('#contact_name').fill(leadName);
  await convertDialog.locator('#contact_phone').fill(leadPhone);
  await convertDialog.getByRole('button', { name: /确\s*定/ }).click();
  await expect(page.getByText('转客户成功')).toBeVisible();
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 30_000 });
  const customerId = page.url().split('/customers/')[1];
  await expect(page.getByText(leadName).first()).toBeVisible();
  await page.screenshot({ path: path.join(artifactDirectory, 'customer-detail-desktop.png'), fullPage: true });

  // API 侧交叉验证：客户档案已落库（复用步骤 5 的登录 token）。
  const customerResponse = await request.get(`${apiBase}/customers/${customerId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(customerResponse.ok(), `GET /customers/${customerId}: ${await customerResponse.text()}`).toBe(true);
  const customerBody = await customerResponse.json();
  expect(customerBody.data.name).toBe(leadName);
  expect(customerBody.data.sourceLeadId).toBe(leadId);

  expect(pageErrors, `browser errors: ${pageErrors.join('\n')}`).toEqual([]);

  // ===== 移动视口关键节点可见 =====
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/leads`);
  await expect(page.getByRole('button', { name: /新建线索/ })).toBeVisible();
  await searchLead(page, leadName);
  await expect(page.getByText(leadName).first()).toBeVisible();
  await page.screenshot({ path: path.join(artifactDirectory, 'leads-list-mobile.png'), fullPage: true });

  await page.goto(`${webBase}/leads/calendar`);
  await expect(page.getByText('到访日历')).toBeVisible();
  await page.screenshot({ path: path.join(artifactDirectory, 'calendar-mobile.png'), fullPage: true });

  expect(pageErrors, `browser errors after mobile pass: ${pageErrors.join('\n')}`).toEqual([]);
});

async function searchLead(page: Page, keyword: string) {
  await page.getByPlaceholder('搜索姓名/电话/编号').fill(keyword);
  await page.getByRole('button', { name: /搜\s*索/ }).click();
}

async function apiLogin(): Promise<string> {
  const response = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(response.ok, `POST /auth/login: ${await response.text()}`).toBe(true);
  const body = await response.json();
  expect(body.data.mode, 'E2E 账号须直达 AUTHENTICATED（无 MFA/强制改密挑战）').toBe('AUTHENTICATED');
  return body.data.token as string;
}

/** 明日 10:00（本地时区），antd DatePicker 可键入的格式。 */
function futureSlot(): string {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())} 10:00`;
}
