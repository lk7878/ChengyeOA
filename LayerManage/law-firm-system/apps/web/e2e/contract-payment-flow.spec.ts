// SPEC-010 Task 11: 谈案→合同→收款全链路 E2E 排练（形态对齐 e2e/lead-crm-flow.spec.ts）。
// 【排练式静态交付：实跑需已运行栈（7001 API + 3000 Web），本 spec 未纳入 CI。】
// 链路：登录 → 创建谈案 → 完结（已签约）→ 创建 FORMAL 合同 → 提交 → 审批 → 签署
//   → 前置 RISK_NOTICE（创建→提交→签署）→ FORMAL 生效 → 收款登记 → 财务确认
//   → 断言应收计划生成/合同状态与已收金额联动。
// 环境驱动（无 playwright.config / 无 e2e npm script）：
//   E2E_API_BASE      默认 http://127.0.0.1:7001/api/v1
//   E2E_WEB_BASE      默认 http://127.0.0.1:3000
//   E2E_ADMIN_USERNAME 预置全权限账号（需 menu.contract/menu.payment + negotiation.*/contract.*/payment.*
//                      + customer.create/read + ALL 数据范围；且必须绑定员工（User.employeeId），
//                      谈案创建需选择自身员工为谈案律师）
//   E2E_ADMIN_PASSWORD 对应密码（账号须直达 AUTHENTICATED，无 MFA/强制改密挑战）
// 截图 artifacts 落 docs/superpowers/reports/artifacts/contract-payment/。
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE ?? 'http://127.0.0.1:7001/api/v1';
const webBase = process.env.E2E_WEB_BASE ?? 'http://127.0.0.1:3000';
const username = process.env.E2E_ADMIN_USERNAME ?? '';
const password = process.env.E2E_ADMIN_PASSWORD ?? '';
const artifactDirectory = path.resolve(process.cwd(), '../../../../docs/superpowers/reports/artifacts/contract-payment');

test.setTimeout(240_000);

test('completes the negotiation-to-contract-to-payment flow on desktop and mobile viewports', async ({ page, request }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  expect(username, 'E2E_ADMIN_USERNAME is required').not.toBe('');
  expect(password, 'E2E_ADMIN_PASSWORD is required').not.toBe('');

  const suffix = Date.now().toString(36).toUpperCase();
  const customerName = `E2E客户${suffix}`;
  const customerPhone = `138${String(Date.now()).slice(-8)}`;
  const formalTitle = `E2E正式委托合同${suffix}`;
  const riskNoticeTitle = `E2E风险告知书${suffix}`;

  // ===== 步骤 0：API 造数——客户（谈案/合同的客户锚）=====
  const token = await apiLogin();
  const customerResponse = await request.post(`${apiBase}/customers`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: customerName, phone: customerPhone },
  });
  expect(customerResponse.ok(), `POST /customers: ${await customerResponse.text()}`).toBe(true);
  const customerId = (await customerResponse.json()).data.id as string;
  const customerCheck = await request.get(`${apiBase}/customers/${customerId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(customerCheck.ok(), `GET /customers/${customerId}: ${await customerCheck.text()}`).toBe(true);
  expect((await customerCheck.json()).data.name).toBe(customerName);

  // ===== 步骤 1：登录（真实登录页 UI）=====
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${webBase}/login`);
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await page.waitForURL(`${webBase}/`, { timeout: 30_000 });
  await expect(page.getByText('谈案合同')).toBeVisible();

  // ===== 步骤 2：创建谈案 =====
  await page.goto(`${webBase}/negotiations`);
  await page.getByRole('button', { name: /新建谈案/ }).click();
  const createDialog = page.getByRole('dialog');
  await createDialog.getByRole('combobox', { name: '客户' }).click();
  await page.getByRole('option', { name: new RegExp(customerName) }).click();
  await createDialog.getByRole('combobox', { name: '谈案律师' }).click();
  await page.getByRole('option').first().click();
  await createDialog.getByLabel('报价金额').fill('50000');
  await createDialog.getByRole('button', { name: /确\s*定/ }).click();
  await expect(page.getByText('谈案创建成功')).toBeVisible();
  await page.getByRole('combobox', { name: '状态筛选' }).click();
  await page.getByRole('option', { name: '谈案中' }).click();
  await page.getByRole('button', { name: /搜\s*索/ }).click();
  const negotiationRow = page.getByRole('row').filter({ hasText: customerName }).first();
  await expect(negotiationRow).toBeVisible();
  await mkdir(artifactDirectory, { recursive: true });
  await page.screenshot({ path: path.join(artifactDirectory, 'negotiations-desktop.png'), fullPage: true });

  // ===== 步骤 3：完结谈案（已签约）=====
  await negotiationRow.getByRole('button', { name: '完结' }).click();
  const closeDialog = page.getByRole('dialog');
  await closeDialog.getByRole('radio', { name: '已签约' }).check();
  await closeDialog.getByRole('button', { name: /确\s*定/ }).click();
  await expect(page.getByText('谈案已完结（签约）')).toBeVisible();

  // ===== 步骤 4：创建 FORMAL 合同（向导：类型→客户→模板→金额分期）=====
  await page.goto(`${webBase}/contracts/new`);
  await page.getByRole('combobox', { name: '合同类型' }).click();
  await page.getByRole('option', { name: '正式委托' }).click();
  await page.locator('#title').fill(formalTitle);
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('combobox', { name: '客户' }).click();
  await page.getByRole('option', { name: new RegExp(customerName) }).click();
  await page.getByRole('button', { name: /下一步/ }).click();
  // 模板步骤：默认选中 FORMAL_STANDARD 标准模板，直接下一步。
  await expect(page.getByText(/FORMAL_STANDARD/)).toBeVisible();
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByLabel('合同金额').fill('50000');
  // 不分期：生效时默认一期（dueDate = effectiveDate + 30 天）。
  await page.getByRole('button', { name: '创建合同' }).click();
  await page.waitForURL(/\/contracts\/[0-9a-f-]+$/, { timeout: 30_000 });
  const formalContractId = page.url().split('/contracts/')[1];
  await expect(page.getByText('草稿').first()).toBeVisible();
  await page.screenshot({ path: path.join(artifactDirectory, 'contract-draft-desktop.png'), fullPage: true });

  // ===== 步骤 5：提交 → 审批 → 签署（详情页按钮矩阵）=====
  await page.getByRole('button', { name: '提交' }).click();
  await page.getByRole('button', { name: /确\s*定/ }).click();
  await expect(page.getByText('提交成功')).toBeVisible();
  await expect(page.getByText('待审批').first()).toBeVisible();

  await page.getByRole('button', { name: '审批通过' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /确\s*定/ }).click();
  await expect(page.getByText('审批通过')).toBeVisible();
  await expect(page.getByText('待签署').first()).toBeVisible();

  await page.getByRole('button', { name: '签署', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /确\s*定/ }).click();
  await expect(page.getByText('签署成功')).toBeVisible();
  // FORMAL 生效前置提示（RISK_NOTICE 门禁）应可见。
  await expect(page.getByText('生效前置提示')).toBeVisible();

  // ===== 步骤 6：前置 RISK_NOTICE（创建 → 提交 → 签署）=====
  await page.goto(`${webBase}/contracts/new`);
  await page.getByRole('combobox', { name: '合同类型' }).click();
  await page.getByRole('option', { name: '风险告知书' }).click();
  await page.locator('#title').fill(riskNoticeTitle);
  await expect(page.getByText(/无需审批/)).toBeVisible();
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('combobox', { name: '客户' }).click();
  await page.getByRole('option', { name: new RegExp(customerName) }).click();
  await page.getByRole('button', { name: /下一步/ }).click();
  await expect(page.getByText('该合同类型不使用模板')).toBeVisible();
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByLabel('合同金额').fill('0.01');
  await page.getByRole('button', { name: '创建合同' }).click();
  await page.waitForURL(/\/contracts\/[0-9a-f-]+$/, { timeout: 30_000 });
  const riskNoticeId = page.url().split('/contracts/')[1];

  await page.getByRole('button', { name: '提交' }).click();
  await page.getByRole('button', { name: /确\s*定/ }).click();
  await expect(page.getByText('提交成功')).toBeVisible();
  // RISK_NOTICE 提交直达待签署（无审批环节）。
  await expect(page.getByText('待签署').first()).toBeVisible();
  await page.getByRole('button', { name: '签署', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /确\s*定/ }).click();
  await expect(page.getByText('签署成功')).toBeVisible();

  // API 交叉验证：RISK_NOTICE 已签署且为事实终态（无生效按钮——签署即终态）。
  const riskNoticeResponse = await request.get(`${apiBase}/contracts/${riskNoticeId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(riskNoticeResponse.ok()).toBe(true);
  expect((await riskNoticeResponse.json()).data.status).toBe('SIGNED');

  // ===== 步骤 7：FORMAL 生效（前置已满足）=====
  await page.goto(`${webBase}/contracts/${formalContractId}`);
  await page.getByRole('button', { name: '生效' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /确\s*定/ }).click();
  await expect(page.getByText('合同已生效')).toBeVisible();
  await expect(page.getByText('已生效').first()).toBeVisible();
  // 应收计划联动断言：不分期 → 默认一期（dueDate = 生效日 + 30 天，金额 = 合同金额）。
  await expect(page.getByText('50000.00').first()).toBeVisible();
  await page.screenshot({ path: path.join(artifactDirectory, 'contract-effective-desktop.png'), fullPage: true });

  const plansResponse = await request.get(`${apiBase}/contracts/${formalContractId}/plans`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(plansResponse.ok(), `GET /contracts/:id/plans: ${await plansResponse.text()}`).toBe(true);
  const plans = (await plansResponse.json()).data as Array<{ period: number; amount: string; status: string }>;
  expect(plans.length).toBe(1);
  expect(plans[0].period).toBe(1);
  expect(plans[0].amount).toBe('50000.00');
  expect(plans[0].status).toBe('PENDING');

  // ===== 步骤 8：收款登记 =====
  await page.goto(`${webBase}/payments`);
  await page.getByRole('button', { name: /登记收款/ }).click();
  const registerDialog = page.getByRole('dialog');
  await registerDialog.getByRole('combobox', { name: '合同' }).click();
  await page.getByRole('option', { name: new RegExp(formalTitle.slice(0, 20)) }).click();
  await registerDialog.getByLabel('收款金额').fill('20000');
  await registerDialog.locator('#method').fill('银行转账');
  await registerDialog.getByRole('button', { name: /确\s*定/ }).click();
  await expect(page.getByText('收款登记成功')).toBeVisible();
  await expect(page.getByText('20000.00')).toBeVisible();
  await page.screenshot({ path: path.join(artifactDirectory, 'payments-desktop.png'), fullPage: true });

  // ===== 步骤 9：财务确认（HIGH 权限按钮 + 确认弹窗）=====
  await page.getByRole('row').filter({ hasText: '20000.00' }).first()
    .getByRole('button', { name: '确认' }).click();
  await page.getByRole('button', { name: /确\s*定/ }).click();
  await expect(page.getByText('收款已确认')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '20000.00' }).first().getByText('已确认')).toBeVisible();

  // ===== 步骤 10：API 断言联动——合同已收金额累计 + 计划冲抵 =====
  const formalAfter = await request.get(`${apiBase}/contracts/${formalContractId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(formalAfter.ok()).toBe(true);
  const formalBody = (await formalAfter.json()).data;
  expect(formalBody.status).toBe('EFFECTIVE');
  expect(formalBody.receivedAmount).toBe('20000.00');

  const plansAfter = await request.get(`${apiBase}/contracts/${formalContractId}/plans`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const plansAfterBody = (await plansAfter.json()).data as Array<{ receivedAmount: string; status: string }>;
  expect(plansAfterBody[0].receivedAmount).toBe('20000.00');
  expect(plansAfterBody[0].status).toBe('PARTIAL');

  expect(pageErrors, `browser errors: ${pageErrors.join('\n')}`).toEqual([]);

  // ===== 移动视口关键节点可见 =====
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/contracts`);
  await expect(page.getByRole('button', { name: /新建合同/ })).toBeVisible();
  await expect(page.getByText(formalTitle).first()).toBeVisible();
  await page.screenshot({ path: path.join(artifactDirectory, 'contracts-mobile.png'), fullPage: true });

  await page.goto(`${webBase}/payments`);
  await expect(page.getByRole('button', { name: /登记收款/ })).toBeVisible();
  await page.screenshot({ path: path.join(artifactDirectory, 'payments-mobile.png'), fullPage: true });

  expect(pageErrors, `browser errors after mobile pass: ${pageErrors.join('\n')}`).toEqual([]);
});

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
