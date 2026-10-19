import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeIntake, prepareAttachments, persistAttachments, cleanAttachments } from '../../app/application/case/case-intake';

test('intake normalizes exact monetary precision, dates, enums and custom proceedings', () => {
  assert.deepEqual(normalizeIntake({ fixedAgencyFee: '9999999999999999.99', riskAgencyRatio: '10.5', signedDate: '2024-02-29', agencyProcedure: '自定义', customProcedure: '自定义测试' }), {
    fixedAgencyFee: '9999999999999999.99', riskAgencyRatio: '10.50', signedDate: '2024-02-29', agencyProcedure: '自定义', customProcedure: '自定义测试',
  });
  for (const data of [{ fixedAgencyFee: '-1' }, { refundAmount: '0.001' }, { riskAgencyRatio: '101' }, { signedDate: '2026-02-30' }, { caseCategory: '无效' }, { agencyProcedure: '自定义' }, { bogus: 'x' }, { customerPhone: 'abc' }]) {
    assert.throws(() => normalizeIntake(data), { code: 'VALIDATION_FAILED' });
  }
});

test('attachment validation rejects malformed or oversized uploads and preserves bytes/category', () => {
  const file = { fileName: '合同.docx', fileType: 'application/octet-stream', category: '合同附件', base64: Buffer.from('contract fixture').toString('base64') };
  const prepared = prepareAttachments([file]);
  assert.equal(prepared[0].category, '合同附件');
  persistAttachments(prepared);
  const stored = path.join(process.cwd(), 'var/storage/case-files', prepared[0].filePath);
  assert.equal(fs.readFileSync(stored, 'utf8'), 'contract fixture');
  cleanAttachments(prepared);
  assert.equal(fs.existsSync(stored), false);
  for (const change of [{ fileName: 'script.exe' }, { category: '其他' }, { base64: '%%%%' }, { base64: '' }, { base64: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64') }]) {
    assert.throws(() => prepareAttachments([{ ...file, ...change }]), { code: 'VALIDATION_FAILED' });
  }
  // Full-size inputs must not overflow the regex stack.
  assert.equal(prepareAttachments([{ ...file, base64: Buffer.alloc(10 * 1024 * 1024).toString('base64') }])[0].buffer.length, 10 * 1024 * 1024);
});

test('web and server intake contracts stay aligned', () => {
  assert.equal(fs.readFileSync('app/application/case/intake-contract.ts', 'utf8'), fs.readFileSync('../web/src/pages/Case/intake-contract.ts', 'utf8'));
});

test('standard intake accepts multi-select, checkbox, datetime and validates percentages', () => {
  const result = normalizeIntake({agencyProcedure:['一审','二审','一审'],receiptMethod:['现金','转账'],installment:false,signedDate:'2026-10-19T10:30:00+08:00',managementFeeRatio:'15',invoiceAmount:'100'});
  assert.equal(result.agencyProcedure, '["一审","二审"]');
  assert.equal(result.installment, 'false');
  assert.equal(result.managementFeeRatio, '15');
  assert.deepEqual(normalizeIntake(result), result);
  for (const data of [{agencyProcedure:['不存在']},{installment:'falsey'},{managementFeeRatio:'0.5'},{signedDate:'2026-02-30T12:00:00+08:00'},{signedDate:'2026-13-01'},{negotiatorId:'fake-user'}]) assert.throws(()=>normalizeIntake(data), {code:'VALIDATION_FAILED'});
});
