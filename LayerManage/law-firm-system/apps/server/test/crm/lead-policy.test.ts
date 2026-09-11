import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPOINTMENT_STATUS,
  canTransition,
  findDuplicateSignals,
  hashPhone,
  hashWechat,
  LEAD_STATUS,
  normalizePhone,
  POOL_STATUS,
  REACTIVATE_ENABLED,
  type DuplicateSignal,
} from '../../app/domain/crm/lead-policy';
import {
  APPOINTMENT_CONFLICT,
  CrmError,
  CUSTOMER_ALREADY_CONVERTED,
  LEAD_NOT_FOUND,
  LEAD_NOT_IN_POOL,
  LEAD_STATE_TRANSITION_INVALID,
} from '../../app/domain/crm/lead-errors';

// SPEC-009 Task 3: lead-policy 领域纯函数与错误码契约测试（TDD 地基）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/crm/lead-policy.test.ts
// 纯单测，不连数据库；按 brief 设置环境变量以防 import 链触发。

test('LEAD_STATUS exports the design §5.1 status vocabulary', () => {
  assert.deepEqual(
    [...LEAD_STATUS].sort(),
    [
      'ASSIGNED',
      'CONTACTED',
      'CONVERTED',
      'INVITED',
      'LOST',
      'NEW',
      'NURTURE',
      'SCREENED',
      'VISITED',
    ],
  );
});

test('POOL_STATUS exports PUBLIC|PRIVATE|RECYCLED per design §5.1', () => {
  assert.deepEqual([...POOL_STATUS].sort(), ['PRIVATE', 'PUBLIC', 'RECYCLED']);
});

test('APPOINTMENT_STATUS exports the schema Appointment status vocabulary', () => {
  assert.deepEqual(
    [...APPOINTMENT_STATUS].sort(),
    ['CANCELLED', 'CONFIRMED', 'NOSHOW', 'PENDING', 'RESCHEDULED', 'VISITED'],
  );
});

test('canTransition allows the forward happy-path chain NEW→...→CONVERTED', () => {
  assert.equal(canTransition('NEW', 'ASSIGNED'), true);
  assert.equal(canTransition('ASSIGNED', 'CONTACTED'), true);
  assert.equal(canTransition('CONTACTED', 'SCREENED'), true);
  assert.equal(canTransition('SCREENED', 'INVITED'), true);
  assert.equal(canTransition('INVITED', 'VISITED'), true);
  assert.equal(canTransition('VISITED', 'CONVERTED'), true);
});

test('canTransition rejects skips such as NEW→VISITED and SCREENED→CONVERTED', () => {
  assert.equal(canTransition('NEW', 'VISITED'), false);
  assert.equal(canTransition('NEW', 'CONVERTED'), false);
  assert.equal(canTransition('ASSIGNED', 'VISITED'), false);
  assert.equal(canTransition('SCREENED', 'CONVERTED'), false);
});

test('canTransition allows any active state to flow to LOST', () => {
  for (const active of ['NEW', 'ASSIGNED', 'CONTACTED', 'SCREENED', 'INVITED', 'VISITED']) {
    assert.equal(canTransition(active as never, 'LOST'), true, `${active}→LOST must be allowed`);
  }
});

test('canTransition allows the LOST→NURTURE placeholder transition', () => {
  assert.equal(canTransition('LOST', 'NURTURE'), true);
});

test('canTransition rejects CONVERTED→NEW terminal regression', () => {
  assert.equal(canTransition('CONVERTED', 'NEW'), false);
  assert.equal(canTransition('CONVERTED', 'CONTACTED'), false);
  assert.equal(canTransition('CONVERTED', 'LOST'), false);
});

test('canTransition rejects same-state transitions', () => {
  for (const status of LEAD_STATUS) {
    assert.equal(canTransition(status, status), false, `${status}→${status} must be rejected`);
  }
});

test('canTransition marks NURTURE→CONTACTED as a structurally legal reactivate arrow', () => {
  // 状态机层表达"状态机允许"（spec §6.1 标了 reactivate 箭头）。
  assert.equal(canTransition('NURTURE', 'CONTACTED'), true);
});

test('REACTIVATE_ENABLED is false so the service layer can gate NURTURE reactivation', () => {
  // 与 canTransition 解耦：policy 表达状态机允许，REACTIVATE_ENABLED 表达本 SPEC 是否启用。
  assert.equal(REACTIVATE_ENABLED, false);
  assert.equal(canTransition('NURTURE', 'CONTACTED'), true);
  assert.equal(canTransition('NURTURE', 'SCREENED'), false);
  assert.equal(canTransition('NURTURE', 'NEW'), false);
});

test('canTransition rejects LOST flowing back to active happy-path states', () => {
  assert.equal(canTransition('LOST', 'ASSIGNED'), false);
  assert.equal(canTransition('LOST', 'CONTACTED'), false);
  assert.equal(canTransition('LOST', 'VISITED'), false);
});

test('canTransition rejects NURTURE flowing to non-CONTACTED active states', () => {
  assert.equal(canTransition('NURTURE', 'SCREENED'), false);
  assert.equal(canTransition('NURTURE', 'INVITED'), false);
  assert.equal(canTransition('NURTURE', 'VISITED'), false);
  assert.equal(canTransition('NURTURE', 'CONVERTED'), false);
  assert.equal(canTransition('NURTURE', 'LOST'), false);
});

test('normalizePhone strips whitespace / dashes / parentheses and the +86|86|0086 CN prefix', () => {
  assert.equal(normalizePhone('+86 138-1234-5678'), '13812345678');
  assert.equal(normalizePhone('86 138-1234-5678'), '13812345678');
  assert.equal(normalizePhone('0086 138-1234-5678'), '13812345678');
  assert.equal(normalizePhone('138-1234-5678'), '13812345678');
  assert.equal(normalizePhone(' 138 1234 5678 '), '13812345678');
  assert.equal(normalizePhone('(010)12345678'), '01012345678');
  assert.equal(normalizePhone('010-12345678'), '01012345678');
});

test('normalizePhone keeps landline / international digit strings without forcing 11 digits', () => {
  assert.equal(normalizePhone('010-1234567'), '0101234567');
  assert.equal(normalizePhone('+1 415 555 2671'), '14155552671');
  // 仅 +86/86/0086 前缀归一；非 CN 国际前缀（如 0044）原样保留为纯数字。
  assert.equal(normalizePhone('0044 20 7183 8750'), '00442071838750');
});

test('normalizePhone throws on non-digit junk or too-short values', () => {
  assert.throws(() => normalizePhone('abc 138'), CrmError);
  assert.throws(() => normalizePhone('138-abc-5678'), CrmError);
  assert.throws(() => normalizePhone('12345'), CrmError); // 不足 7 位
  assert.throws(() => normalizePhone(''), CrmError);
  assert.throws(() => normalizePhone('   '), CrmError);
  assert.throws(() => normalizePhone('+86'), CrmError); // 只有前缀
});

test('normalizePhone throws CrmError with VALIDATION_FAILED-style code', () => {
  try {
    normalizePhone('abc 138');
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err instanceof CrmError, 'must be a CrmError instance');
    assert.equal((err as CrmError).code, 'LEAD_PHONE_INVALID');
    assert.ok((err as CrmError).httpStatus === 400, 'must map to HTTP 400');
  }
});

test('hashPhone is deterministic, hex sha256, equal for equal normalized input', () => {
  const a = hashPhone('13812345678');
  const b = hashPhone('13812345678');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/, 'must return 64-char lowercase hex');
});

test('hashPhone differs across distinct normalized inputs', () => {
  const a = hashPhone('13812345678');
  const b = hashPhone('13912345678');
  assert.notEqual(a, b);
});

test('hashPhone is not a password hash (no salt) and equals raw sha256 of the input', async () => {
  const { createHash } = await import('node:crypto');
  const expected = createHash('sha256').update('13812345678', 'utf8').digest('hex');
  assert.equal(hashPhone('13812345678'), expected);
});

test('hashWechat returns null for nullish/empty input', () => {
  assert.equal(hashWechat(undefined), null);
  assert.equal(hashWechat(''), null);
  assert.equal(hashWechat('   '), null);
});

test('hashWechat trims input and returns deterministic hex sha256', () => {
  const a = hashWechat('wx_abc');
  const b = hashWechat('  wx_abc  ');
  assert.equal(a, b);
  assert.match(a ?? '', /^[0-9a-f]{64}$/);
});

test('hashWechat differs across distinct inputs', () => {
  assert.notEqual(hashWechat('wx_abc'), hashWechat('wx_def'));
});

test('findDuplicateSignals returns PHONE signal when phoneHash matches exactly', () => {
  const phoneHash = hashPhone('13812345678');
  const result = findDuplicateSignals(
    { phoneHash },
    [{ id: 'lead-1', name: '张三', phoneHash, wechatHash: undefined }],
  );
  assert.deepEqual(result, [{ leadId: 'lead-1', type: 'PHONE' }]);
});

test('findDuplicateSignals returns WECHAT signal when wechatHash matches exactly', () => {
  const wechatHash = hashWechat('wx_abc');
  const result = findDuplicateSignals(
    { wechatHash },
    [{ id: 'lead-1', name: '张三', phoneHash: 'other', wechatHash }],
  );
  assert.deepEqual(result, [{ leadId: 'lead-1', type: 'WECHAT' }]);
});

test('findDuplicateSignals returns NAME signal on case-sensitive exact name match', () => {
  const result = findDuplicateSignals(
    { name: '张三' },
    [{ id: 'lead-1', name: '张三', phoneHash: 'x', wechatHash: undefined }],
  );
  assert.deepEqual(result, [{ leadId: 'lead-1', type: 'NAME' }]);
});

test('findDuplicateSignals is case-sensitive (张三 does not match 张4)', () => {
  const result = findDuplicateSignals(
    { name: '张三' },
    [{ id: 'lead-1', name: '张4', phoneHash: 'x', wechatHash: undefined }],
  );
  assert.deepEqual(result, []);
  // 大小写敏感
  assert.deepEqual(
    findDuplicateSignals(
      { name: 'AbC' },
      [{ id: 'lead-2', name: 'abc', phoneHash: 'x', wechatHash: undefined }],
    ),
    [],
  );
});

test('findDuplicateSignals returns multiple signals per candidate when several keys hit', () => {
  const phoneHash = hashPhone('13812345678');
  const wechatHash = hashWechat('wx_abc');
  const result = findDuplicateSignals(
    { name: '张三', phoneHash, wechatHash },
    [{ id: 'lead-1', name: '张三', phoneHash, wechatHash }],
  );
  assert.deepEqual(
    result.sort(),
    [
      { leadId: 'lead-1', type: 'PHONE' },
      { leadId: 'lead-1', type: 'WECHAT' },
      { leadId: 'lead-1', type: 'NAME' },
    ],
  );
});

test('findDuplicateSignals returns signals across multiple candidates', () => {
  const phoneHash = hashPhone('13812345678');
  const result = findDuplicateSignals(
    { phoneHash },
    [
      { id: 'lead-1', name: 'A', phoneHash, wechatHash: undefined },
      { id: 'lead-2', name: 'B', phoneHash: 'other', wechatHash: undefined },
      { id: 'lead-3', name: 'C', phoneHash, wechatHash: undefined },
    ],
  );
  assert.deepEqual(result.sort(), [
    { leadId: 'lead-1', type: 'PHONE' },
    { leadId: 'lead-3', type: 'PHONE' },
  ]);
});

test('findDuplicateSignals never returns plaintext phone/wechat/name', () => {
  const phoneHash = hashPhone('13812345678');
  const wechatHash = hashWechat('wx_abc');
  const result: DuplicateSignal[] = findDuplicateSignals(
    { name: '张三', phoneHash, wechatHash },
    [{ id: 'lead-1', name: '张三', phoneHash, wechatHash }],
  );
  for (const signal of result) {
    assert.equal(typeof signal.leadId, 'string');
    assert.ok(['PHONE', 'WECHAT', 'NAME'].includes(signal.type));
    // 信号对象只能有 leadId + type 两个字段，不携带明文。
    assert.deepEqual(Object.keys(signal).sort(), ['leadId', 'type']);
  }
});

test('CrmError carries stable code + httpStatus from design §7', () => {
  const err = new CrmError(LEAD_NOT_FOUND, 404, 'lead missing');
  assert.equal(err.code, 'LEAD_NOT_FOUND');
  assert.equal(err.httpStatus, 404);
  assert.equal(err.message, 'lead missing');
  assert.equal(err.name, 'CrmError');
  assert.ok(err instanceof Error);
});

test('lead-errors exports the stable §7 error codes as bare string constants', () => {
  assert.equal(LEAD_NOT_FOUND, 'LEAD_NOT_FOUND');
  assert.equal(LEAD_STATE_TRANSITION_INVALID, 'LEAD_STATE_TRANSITION_INVALID');
  assert.equal(LEAD_NOT_IN_POOL, 'LEAD_NOT_IN_POOL');
  assert.equal(APPOINTMENT_CONFLICT, 'APPOINTMENT_CONFLICT');
  assert.equal(CUSTOMER_ALREADY_CONVERTED, 'CUSTOMER_ALREADY_CONVERTED');
});
