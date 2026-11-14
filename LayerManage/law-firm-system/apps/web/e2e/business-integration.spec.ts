import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import type { ApprovalAttachment } from '../src/api/approval-materials';
import type { PayrollBatch } from '../src/api/business-integration';
test.use({ channel: 'msedge', viewport: { width: 1450, height: 1000 } });
test('salary workbook persists edits, exports edited bytes and submits that exact attachment', async ({ page }) => {
  const files = new Map<string, { meta: ApprovalAttachment; bytes: Buffer }>();
  let batch: PayrollBatch | undefined;
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/v1/**', async route => {
    const req = route.request(), url = new URL(req.url());
    const respond = (data: unknown) => route.fulfill({ json: { code: 200, message: 'success', data } });
    if (url.pathname === '/api/v1/approval-files' && req.method() === 'POST') {
      const body = req.postDataBuffer()!;
      const split = body.indexOf(Buffer.from('\r\n\r\n'));
      const end = body.lastIndexOf(Buffer.from('\r\n--'));
      const fileName = body.subarray(0, split).toString().match(/filename="([^"]+)"/)![1];
      const bytes = body.subarray(split + 4, end), id = 'file-' + files.size;
      const meta: ApprovalAttachment = { id, fileName, fileSize: bytes.length, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sourceId: url.searchParams.get('sourceId'), instanceId: null, createdAt: new Date().toISOString() };
      files.set(id, { meta, bytes }); return respond(meta);
    }
    if (url.pathname.startsWith('/api/v1/approval-files/')) { const file = files.get(url.pathname.split('/').pop()!)!; return respond({ ...file.meta, base64: file.bytes.toString('base64') }); }
    if (url.pathname.startsWith('/api/v1/payroll-batches')) {
      if (req.method() === 'GET') return respond({ list: batch ? [batch] : [], total: batch ? 1 : 0 });
      const data = req.postDataJSON(); batch = { ...data, id: 'payroll-1', version: batch ? batch.version + 1 : 1, instance: null, attachment: files.get(data.attachmentId)!.meta }; return respond(batch);
    }
    if (url.pathname === '/api/v1/approvals/definitions') return respond([{ code: 'PAYROLL', name: '工资审批', businessType: 'PAYROLL', formSchema: { fields: [{ key: 'period', type: 'text', label: '月份' }] } }]);
    if (url.pathname === '/api/v1/approvals' && req.method() === 'POST') { submitted = req.postDataJSON(); batch!.instance = { id: 'approval-1', status: 'PENDING' }; return respond({ id: 'approval-1' }); }
    return respond([]);
  });
  await page.goto('http://localhost:3000/e2e/business-integration.html');
  await page.getByRole('button', { name: '导入工资表', exact: true }).click();
  await page.getByRole('textbox', { name: '工资表名称', exact: true }).fill('九月工资');
  await page.getByRole('textbox', { name: '工资月份', exact: true }).fill('2026-09');
  const wb = new ExcelJS.Workbook(); wb.addWorksheet('工资').addRows([['姓名', '实发'], ['张三', 8000]]);
  await page.locator('input[type=file]').setInputFiles({ name: '工资.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await wb.xlsx.writeBuffer()) });
  await expect(page.getByText('工资.xlsx', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确 定', exact: true }).click();
  await expect(page.getByRole('cell', { name: '九月工资', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '预览 / 编辑' }).click();
  await page.getByRole('textbox', { name: '工资 B2', exact: true }).fill('8800');
  await page.getByRole('button', { name: '保存修改版为附件' }).click();
  await expect.poll(() => batch?.version).toBe(2);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '预览 / 编辑' }).click();
  await expect(page.getByRole('textbox', { name: '工资 B2', exact: true })).toHaveValue('8800');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: '下载', exact: true }).click();
  const download = await downloading; const result = new ExcelJS.Workbook(); await result.xlsx.load(await readFile((await download.path())!)); expect(result.worksheets[0].getCell('B2').value).toBe(8800);
  await page.getByRole('button', { name: '发起审批', exact: true }).click();
  await page.getByRole('combobox', { name: '工资审批流程' }).click(); await page.getByText('工资审批', { exact: true }).click();
  await page.getByRole('button', { name: '确 定', exact: true }).click();
  await expect(page.getByText('审批中', { exact: true })).toBeVisible();
  expect(submitted?.attachmentIds).toEqual([batch!.attachmentId]); expect(submitted?.payrollBatchId).toBe('payroll-1');
  await expect(page.getByRole('button', { name: '预览 / 编辑' })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('payroll-submitted.png'), fullPage: true });
});

test('finance workspace carries the exact case number across all three tabs', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/v1/**', route => { requests.push(route.request().url()); return route.fulfill({ json: { code: 200, message: 'success', data: { list: [], total: 0, page: 1, pageSize: 10 } } }); });
  await page.goto('http://localhost:3000/e2e/business-integration.html?finance=1');
  await page.getByRole('searchbox', { name: '案件编号查询' }).fill('CA-001');
  // Keep the harness selector in this test's URL while exercising real tab navigation.
  await page.getByRole('button', { name: '按案件查询' }).click();
  await expect.poll(() => requests.some(url => url.includes('/payments?') && url.includes('caseNo=CA-001'))).toBe(true);
  await page.getByRole('tab', { name: '开票管理' }).click();
  await expect.poll(() => requests.some(url => url.includes('/invoices?') && url.includes('caseNo=CA-001'))).toBe(true);
  await page.getByRole('tab', { name: '退款减免' }).click();
  await expect.poll(() => requests.some(url => url.includes('/refunds?') && url.includes('caseNo=CA-001'))).toBe(true);
});
