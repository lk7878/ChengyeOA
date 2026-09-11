import { expect, test, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { readWord, writeWord, readWorkbook, setCellText, writeWorkbook, cellText } from './office-documents';
import { materialBlocks, blocksHtml } from './approval-print';
import type { ApprovalMaterial } from '@/api/approval-materials';

// Use the same standalone implementation selected by Vite's browser resolution.
vi.mock('mammoth', async () => ({ default: (await import('mammoth/mammoth.browser')).default }));
const blobBuffer = (blob: Blob): Promise<ArrayBuffer> => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });

test('XLSX edits and row/column changes round-trip through a real workbook', async () => {
  const source = new ExcelJS.Workbook(); const sheet = source.addWorksheet('工资');
  sheet.addRows([['姓名', '工资'], ['张三', 8000], ['李四', 7000]]);
  const bytes = await source.xlsx.writeBuffer(); const workbook = await readWorkbook(new Uint8Array(bytes).buffer);
  const current = workbook.worksheets[0]; setCellText(current, 2, 2, '8500');
  current.spliceRows(3, 1, ['王五', 9000]); current.spliceColumns(3, 0, ['备注', '已核对', '待发放']);
  const output = await writeWorkbook(workbook); const checked = await readWorkbook(await blobBuffer(output));
  expect(checked.worksheets[0].getCell('B2').value).toBe(8500);
  expect(checked.worksheets[0].getCell('A3').value).toBe('王五');
  expect(checked.worksheets[0].getCell('C3').value).toBe('待发放');
});
test('formulas are protected, text cannot inject a formula, and cached results are marked stale', () => {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Sheet');
  sheet.getCell('A1').value = { formula: '1+1', result: 2 };
  expect(() => setCellText(sheet, 1, 1, '3')).toThrow(/公式/);
  expect(cellText(sheet.getCell('A1').value, true)).toContain('待重算');
  expect(cellText(sheet.getCell('A1').value, true)).not.toContain('（2）');
  setCellText(sheet, 2, 1, '=HYPERLINK("evil")'); expect(sheet.getCell('A2').type).toBe(ExcelJS.ValueType.String);
});
test('DOCX paragraphs/tables are editable content and export can be read back', async () => {
  const original = await writeWord([{ kind: 'paragraph', text: '请假申请' }, { kind: 'table', rows: [['姓名', '天数'], ['张三', '2']] }]);
  const document = await readWord(await blobBuffer(original));
  expect(document.html).toContain('请假申请');
  const table = document.blocks.find(block => block.kind === 'table');
  expect(table?.kind).toBe('table');
  if (table?.kind !== 'table') throw new Error('table missing');
  table.rows[1][1] = '3'; table.rows.push(['李四', '1']);
  document.blocks.unshift({ kind: 'paragraph', text: '修改后的申请' });
  document.blocks.push({ kind: 'table', rows: [[]] });
  const result = await readWord(await blobBuffer(await writeWord(document.blocks)));
  expect(result.blocks[0]).toEqual({ kind: 'paragraph', text: '修改后的申请' });
  expect(result.blocks.find(block => block.kind === 'table')).toEqual({ kind: 'table', rows: [['姓名', '天数'], ['张三', '3'], ['李四', '1']] });
});
test('print material contains status, field labels, people, evidence and signature lines; escapes HTML', () => {
  const material = { instance: { definitionId: 'def', definitionVersion: 1, currentNode: 0, nodeSchema: null, decidedBy: null, decidedAt: null, version: 1, createdBy: 'u', updatedAt: '2026-09-11T00:00:00Z', tasks: [], id: 'a', title: '<script>坏</script>', businessType: 'CUSTOM', status: 'PENDING', applicantId: 'u', createdAt: '2026-09-11T00:00:00Z', content: { reason: '请假' }, formSnapshot: { name: '年假', formSchema: { fields: [{ key: 'reason', label: '事由' }] } } }, tasks: [], people: [{ id: 'u', name: '张三' }], attachments: [{ id: 'file', mimeType: 'application/pdf', sourceId: null, instanceId: 'a', createdAt: '2026-09-11T00:00:00Z', fileName: '证明.pdf', fileSize: 1024 }] } satisfies ApprovalMaterial;
  const html = blocksHtml(materialBlocks(material));
  for (const value of ['尚未通过', '事由', '张三', '证明.pdf', '申请人签字', '归档编号', '&lt;script&gt;']) expect(html).toContain(value);
  expect(html).not.toContain('<script>');
});
