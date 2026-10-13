import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { domainSources, DomainSource } from '../../app/application/crm/workspace-domain-source';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let db: PrismaClient, owner: CollaborationService, staff: CollaborationService;
let org: string, outside: string, base: string;
const rejects = (expected: string) => (e: unknown) => (e as { code?: string }).code === expected;
const context = (userId: string, employeeId: string): AuthorizationContext => {
  const permissionCodes: AuthorizationContext['permissionCodes'] = [
    'customer.read',
    'customer.update',
    'negotiation.read',
    'negotiation.update',
    'contract.read',
    'contract.submit',
  ];
  return {
    userId,
    employeeId,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    evaluatedAt: new Date(),
    permissionCodes,
    fieldRules: [],
    grants: permissionCodes.map((permissionCode) => ({
      sourceType: 'ROLE',
      sourceId: 'fixture',
      sourceRoleId: 'fixture',
      permissionCode,
      resource: permissionCode.split('.')[0],
      scopeIds: ['ALL'],
      validUntil: null,
    })),
  };
};
test.before(() => {
  db = createTestPrisma();
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  org = key();
  outside = key();
  for (const id of [org, outside])
    await db.organization.create({
      data: { id, code: id, name: '同源测试组织', type: 'FIRM', path: '/' + id },
    });
  const position = await db.position.create({
    data: { organizationId: org, code: key(), name: '业务岗位', categoryCode: 'SALES' },
  });
  const actor = async () => {
    const employee = await db.employee.create({
      data: {
        name: '测试人员',
        employeeNo: key(),
        phone: '13800001234',
        type: 'SALES',
        status: 'FORMAL',
        entryDate: new Date('2025-01-01'),
      },
    });
    const user = await db.user.create({
      data: { username: key(), password: 'fixture-only', employeeId: employee.id },
    });
    await db.employeeAssignment.create({
      data: {
        organizationId: org,
        positionId: position.id,
        employeeId: employee.id,
        assignmentType: 'PRIMARY',
        startedAt: new Date('2025-01-01'),
      },
    });
    return new CollaborationService(db, context(user.id, employee.id));
  };
  owner = await actor();
  staff = await actor();
  const workspace = await db.collabWorkspace.create({
    data: {
      name: 'U5 工作区',
      organizationId: org,
      ownerId: owner.actor.userId,
      members: {
        create: [
          { principalId: owner.actor.userId, role: 'OWNER', rowScope: 'ALL', canCreate: true },
          { principalId: staff.actor.userId, role: 'EDITOR', rowScope: 'SELF', canCreate: false },
        ],
      },
    },
  });
  base = (await owner.createBase(workspace.id, { name: '客户经营' }, key())).id;
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});
async function seed(source: DomainSource, creator = staff.actor.userId, branchId = org, amount = '12.34') {
  const lead = await db.lead.create({
    data: {
      leadNo: key(),
      name: '来源',
      phone: '13800001234',
      phoneHash: key(),
      createdBy: creator,
      branchId,
    },
  });
  const customer = await db.customer.create({
    data: {
      customerNo: key(),
      name: '客户',
      phone: '13800001234',
      phoneHash: key(),
      sourceLeadId: lead.id,
      createdBy: creator,
    },
  });
  if (source === 'CUSTOMERS') return customer;
  if (source === 'NEGOTIATIONS')
    return db.negotiation.create({
      data: {
        negotiationNo: key(),
        customerId: customer.id,
        negotiatorEmployeeId: staff.actor.employeeId!,
        quotedAmount: amount,
        branchId,
        createdBy: creator,
      },
    });
  return db.contract.create({
    data: {
      contractNo: key(),
      contractType: 'FORMAL',
      title: '合同',
      customerId: customer.id,
      amount,
      branchId,
      createdBy: creator,
    },
  });
}
test('customers created by an owner without employment are visible while resource and domain scopes still apply', async () => {
  await db.user.update({ where: { id: owner.actor.userId }, data: { employeeId: null } });
  const table = (await owner.createTable(base, { name: '客户记录', source: 'CUSTOMERS' }, key())).id;
  const customer = await db.customer.create({ data: { customerNo: key(), name: '管理员客户', phone: '13800001234', phoneHash: key(), createdBy: owner.actor.userId } });
  const unrelated = await db.user.create({ data: { username: key(), password: 'unused' } });
  await db.customer.create({ data: { customerNo: key(), name: '其他未归属客户', phone: '13800001234', phoneHash: key(), createdBy: unrelated.id } });
  assert.deepEqual((await owner.query(table, {})).records.map((r) => r.id), [customer.id]);
  assert.equal((await staff.query(table, {})).total, 0);
  await db.collabMember.updateMany({ where: { principalId: staff.actor.userId }, data: { rowScope: 'ALL' } });
  assert.deepEqual((await staff.query(table, {})).records.map((r) => r.id), [customer.id]);
  const denied = new CollaborationService(db, { ...staff.actor, permissionCodes: [], grants: [] });
  await assert.rejects(denied.query(table, {}), rejects('COLLAB_FORBIDDEN'));
});
test('unassigned contracts use creator/workspace anchors without bypassing contract or resource scopes', async () => {
  await db.user.update({ where: { id: owner.actor.userId }, data: { employeeId: null } });
  const table = (await owner.createTable(base, { name: '合同记录', source: 'CONTRACTS' }, key())).id;
  const ownerContract = await seed('CONTRACTS', owner.actor.userId);
  const staffContract = await seed('CONTRACTS', staff.actor.userId);
  await db.contract.updateMany({
    where: { id: { in: [ownerContract.id, staffContract.id] } },
    data: { branchId: null },
  });
  const foreign = await seed('CONTRACTS', owner.actor.userId, outside);
  const unrelated = await db.user.create({ data: { username: key(), password: 'unused' } });
  const unrelatedContract = await seed('CONTRACTS', unrelated.id);
  await db.contract.update({ where: { id: unrelatedContract.id }, data: { branchId: null } });
  assert.deepEqual(
    new Set((await owner.query(table, {})).records.map((r) => r.id)),
    new Set([ownerContract.id, staffContract.id]),
  );
  assert.equal((await owner.record(table, ownerContract.id)).record.id, ownerContract.id);
  assert.equal(
    (await owner.businessTables({ source: 'CONTRACTS', recordId: ownerContract.id })).tables[0].id,
    table,
  );
  await assert.rejects(owner.record(table, foreign.id), rejects('COLLAB_NOT_FOUND'));
  await assert.rejects(owner.record(table, unrelatedContract.id), rejects('COLLAB_NOT_FOUND'));
  assert.deepEqual(
    (await staff.query(table, {})).records.map((r) => r.id),
    [staffContract.id],
  );
  await db.collabMember.updateMany({ where: { principalId: staff.actor.userId }, data: { rowScope: 'ALL' } });
  const selfScope = await db.dataScope.create({ data: { name: key(), scopeType: 'SELF' } });
  const scoped = new CollaborationService(db, {
    ...staff.actor,
    grants: staff.actor.grants.map((g) => ({ ...g, scopeIds: [selfScope.id] })),
  });
  assert.deepEqual(
    (await scoped.query(table, {})).records.map((r) => r.id),
    [staffContract.id],
  );
  const denied = new CollaborationService(db, { ...staff.actor, permissionCodes: [], grants: [] });
  await assert.rejects(denied.query(table, {}), rejects('COLLAB_FORBIDDEN'));
});
for (const source of ['CUSTOMERS', 'NEGOTIATIONS', 'CONTRACTS'] as DomainSource[])
  test(`${source}: canonical IDs, domain/resource scopes, extension versions and controlled core fields`, async () => {
    const table = (await owner.createTable(base, { name: source, source }, key())).id;
    const own = await seed(source);
    const other = await seed(source, owner.actor.userId);
    const foreign = await seed(source, staff.actor.userId, outside);
    assert.deepEqual(
      (await staff.query(table, {})).records.map((r) => r.id),
      [own.id],
    );
    assert.equal((await owner.query(table, {})).total, 2);
    await assert.rejects(staff.record(table, other.id), rejects('COLLAB_NOT_FOUND'));
    await assert.rejects(owner.record(table, foreign.id), rejects('COLLAB_NOT_FOUND'));
    const directory = await staff.businessTables({ source, recordId: own.id });
    assert.equal(directory.tables[0].id, table);
    assert.equal((await staff.businessTables({ source, recordId: other.id })).tables.length, 0);
    let detail = await owner.describe(table);
    const field = await owner.saveField(
      table,
      undefined,
      { name: '协作备注', type: 'TEXT', version: detail.table.schemaVersion },
      key(),
    );
    detail = await staff.describe(table);
    assert.equal(detail.fields.find((f) => f.id === field.id)?.writable, true);
    const input = {
      schemaVersion: detail.table.schemaVersion,
      version: own.version,
      values: { [field.id]: '第一版' },
    };
    const mutation = key();
    const saved = await staff.saveRecord(table, own.id, input, mutation);
    assert.deepEqual(await staff.saveRecord(table, own.id, input, mutation), saved);
    assert.equal((await owner.record(table, own.id)).record.values[field.id], '第一版');
    await assert.rejects(staff.saveRecord(table, own.id, input, key()), rejects('COLLAB_RECORD_CONFLICT'));
    const core = detail.fields.find((f) => Boolean((f.options as { businessKey?: string }).businessKey))!;
    await assert.rejects(
      staff.saveRecord(
        table,
        own.id,
        { ...input, version: own.version + 1, values: { [core.id]: '伪造' } },
        key(),
      ),
      rejects('COLLAB_USE_BUSINESS_ACTION'),
    );
    assert.equal(await db.collabRecord.count({ where: { tableId: table } }), 0);
    const noAction = new CollaborationService(db, {
      ...staff.actor,
      permissionCodes: staff.actor.permissionCodes.filter((p) => p !== domainSources[source].edit),
    });
    await assert.rejects(
      noAction.saveRecord(table, own.id, { ...input, version: own.version + 1 }, key()),
      rejects('COLLAB_FORBIDDEN'),
    );
  });
test('customer masking, hidden query rejection, creator organization fallback and original SELF scope', async () => {
  const table = (await owner.createTable(base, { name: '客户', source: 'CUSTOMERS' }, key())).id;
  const row = await seed('CUSTOMERS');
  const detail = await staff.describe(table);
  const phone = detail.fields.find((f) => (f.options as { businessKey?: string }).businessKey === 'phone')!;
  assert.equal((await staff.record(table, row.id)).record.values[phone.id], '138****1234');
  await assert.rejects(
    staff.query(table, { config: { filter: { fieldId: phone.id, operator: 'contains', value: '138' } } }),
    rejects('COLLAB_SENSITIVE_QUERY_UNSUPPORTED'),
  );
  await db.customer.update({ where: { id: row.id }, data: { sourceLeadId: null } });
  assert.equal((await owner.query(table, {})).total, 1);
  await seed('CUSTOMERS', owner.actor.userId);
  const selfScope = await db.dataScope.create({ data: { name: key(), scopeType: 'SELF' } });
  const self = new CollaborationService(db, {
    ...owner.actor,
    grants: owner.actor.grants.map((g) => ({ ...g, scopeIds: [selfScope.id] })),
  });
  assert.equal((await self.query(table, {})).total, 1);
  const hidden = new CollaborationService(db, {
    ...staff.actor,
    fieldRules: [
      {
        sourceRoleId: 'fixture',
        resource: 'customer',
        fieldCode: 'customer.phone',
        readLevel: 'NONE',
        canWrite: false,
        canExport: false,
      },
    ],
  });
  assert.ok(!(await hidden.describe(table)).fields.some((f) => f.id === phone.id));
  assert.ok(!Object.hasOwn((await hidden.record(table, row.id)).record.values, phone.id));
});
test('decimal business amounts filter and sort in SQL without integer truncation', async () => {
  const table = (await owner.createTable(base, { name: '合同金额', source: 'CONTRACTS' }, key())).id;
  const low = await seed('CONTRACTS', staff.actor.userId, org, '9.99');
  const high = await seed('CONTRACTS', staff.actor.userId, org, '12.34');
  const large = await seed('CONTRACTS', staff.actor.userId, org, '90071992547409.93');
  const field = (await owner.describe(table)).fields.find(
    (f) => (f.options as { businessKey?: string }).businessKey === 'amount',
  )!;
  const result = await owner.query(table, {
    config: {
      filter: { fieldId: field.id, operator: 'gte', value: 10.01 },
      sorts: [{ fieldId: field.id, direction: 'asc' }],
    },
  });
  assert.deepEqual(
    result.records.map((r) => r.id),
    [high.id, large.id],
  );
  assert.equal(result.records[1].values[field.id], '90071992547409.93');
  assert.notEqual(low.id, high.id);
});

test('related customer labels obey customer read, organization and creator scope', async () => {
  const table = (await owner.createTable(base, { name: '客户关联', source: 'CONTRACTS' }, key())).id;
  const row = await seed('CONTRACTS');
  const contract = await db.contract.findUniqueOrThrow({ where: { id: row.id } });
  const field = (await staff.describe(table)).fields.find(
    (f) => (f.options as { businessKey?: string }).businessKey === 'customerId',
  )!;
  assert.ok((await staff.query(table, {})).records[0].displayValues?.[field.id]?.includes('客户'));
  await db.customer.update({ where: { id: contract.customerId }, data: { createdBy: owner.actor.userId } });
  assert.equal((await staff.query(table, {})).records[0].displayValues, undefined);
  assert.ok((await owner.query(table, {})).records[0].displayValues?.[field.id]);
  const noCustomer = new CollaborationService(db, {
    ...owner.actor,
    permissionCodes: owner.actor.permissionCodes.filter((p) => p !== 'customer.read'),
  });
  assert.equal((await noCustomer.query(table, {})).records[0].displayValues, undefined);
});
