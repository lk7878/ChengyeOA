import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { ContractService } from '../../app/application/contract/contract-service';
import { CreateContractInput } from '../../app/application/contract/contract-types';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import {
  CONTRACT_ERROR_CODES,
  CONTRACT_ERROR_HTTP_STATUS,
  CONTRACT_TERMINATE_CONFLICT,
  ContractError,
} from '../../app/domain/contract/contract-errors';
import { hashPhone } from '../../app/domain/crm/lead-policy';
import { MasterDataError } from '../../app/domain/master-data/master-data-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-010 Task 7: contract-service A 契约测试（创建四来源/提交/审批/驳回/签署/数据范围/事件同事务）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/contract/contract-service.test.ts

let prisma: PrismaClient;

const CONTRACT_PERMISSIONS: PermissionCode[] = [
  'contract.read',
  'contract.create',
  'contract.submit',
  'contract.approve',
  'contract.sign',
  'contract.effect',
  'contract.terminate',
  'contract.void',
];

const CONTRACT_NO_PATTERN = /^(FS|WT|SA|RN)-[A-Z0-9]+-[A-Z0-9]+-\d{4}-\d{4}$/;

test.before(() => {
  prisma = createTestPrisma();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

interface ContextOverrides {
  employeeId?: string | null;
  permissionCodes?: PermissionCode[];
  scopeIds?: string[];
}

function contractContext(userId: string, overrides: ContextOverrides = {}): AuthorizationContext {
  const permissionCodes = overrides.permissionCodes ?? CONTRACT_PERMISSIONS;
  const scopeIds = overrides.scopeIds ?? ['ALL'];
  return {
    userId,
    employeeId: overrides.employeeId ?? null,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    grants: permissionCodes.map((permissionCode) => ({
      sourceType: 'ROLE' as const,
      sourceId: `${userId}-grant-${permissionCode}`,
      sourceRoleId: 'test-role',
      permissionCode,
      resource: permissionCode.split('.')[0],
      scopeIds,
      validUntil: null,
    })),
    fieldRules: [],
    permissionCodes,
    evaluatedAt: new Date(),
  };
}

async function createActor(): Promise<{ userId: string; actor: AuditActor }> {
  const user = await prisma.user.create({
    data: { username: `contract.actor.${randomUUID()}`, password: 'x' },
  });
  return {
    userId: user.id,
    actor: { actorUserId: user.id, requestId: `req-${randomUUID()}` },
  };
}

function serviceFor(userId: string, actor: AuditActor, overrides: ContextOverrides = {}): ContractService {
  return new ContractService(prisma, actor, contractContext(userId, overrides));
}

async function createOrganizationFixture(code: string, parent?: { id: string; path: string }) {
  const id = randomUUID();
  return prisma.organization.create({
    data: {
      id,
      code,
      name: code,
      type: 'BRANCH',
      parentId: parent?.id,
      path: parent ? `${parent.path}/${id}` : `/${id}`,
      level: parent ? parent.path.split('/').length - 1 : 0,
    },
  });
}

async function createTeamFixture(code: string, homeOrganizationId: string) {
  return prisma.professionalTeam.create({
    data: {
      code,
      name: `${code} 团队`,
      categoryCode: 'OTHER',
      homeOrganizationId,
    },
  });
}

async function createEmployeeInOrg(organizationId: string, code: string) {
  const position = await prisma.position.create({
    data: {
      organizationId,
      code: `POS_${randomUUID()}`,
      name: `${code} position`,
      categoryCode: 'STAFF',
    },
  });
  return prisma.employee.create({
    data: {
      employeeNo: `EMP_${randomUUID()}`,
      name: code,
      phone: `1${randomUUID().replaceAll('-', '').slice(0, 10)}`,
      type: 'SALES',
      status: 'FORMAL',
      entryDate: new Date('2025-01-01'),
      assignments: {
        create: {
          organizationId,
          positionId: position.id,
          assignmentType: 'PRIMARY',
          startedAt: new Date('2025-01-01'),
        },
      },
    },
  });
}

async function createEmployeeFixture(code: string) {
  const orgId = randomUUID();
  await prisma.organization.create({
    data: { id: orgId, code: `ORG_${orgId}`, name: code, type: 'BRANCH', path: `/${orgId}` },
  });
  return createEmployeeInOrg(orgId, code);
}

async function createCustomerFixture(createdBy: string) {
  return prisma.customer.create({
    data: {
      customerNo: `CU-SEED-${randomUUID()}`,
      name: '合同客户',
      phone: '13900002222',
      phoneHash: hashPhone('13900002222'),
      status: 'INTENT',
      createdBy,
    },
  });
}

async function createNegotiationFixture(overrides: {
  customerId: string;
  negotiatorEmployeeId: string;
  createdBy: string;
  status?: string;
}) {
  return prisma.negotiation.create({
    data: {
      negotiationNo: `NE-SEED-${randomUUID()}`,
      customerId: overrides.customerId,
      negotiatorEmployeeId: overrides.negotiatorEmployeeId,
      createdBy: overrides.createdBy,
      status: overrides.status ?? 'NEGOTIATING',
    },
  });
}

async function createContractFixture(overrides: {
  customerId: string;
  createdBy: string;
  contractType?: string;
  status?: string;
  branchId?: string | null;
  professionalTeamId?: string | null;
  title?: string;
}) {
  return prisma.contract.create({
    data: {
      contractNo: `XX-SEED-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      contractType: overrides.contractType ?? 'FIRST_SIGN',
      title: overrides.title ?? '夹具合同',
      customerId: overrides.customerId,
      createdBy: overrides.createdBy,
      status: overrides.status ?? 'DRAFT',
      branchId: overrides.branchId ?? null,
      professionalTeamId: overrides.professionalTeamId ?? null,
    },
  });
}

async function createTemplateFixture(overrides: {
  code: string;
  contractType?: string;
  version?: number;
  enabled?: boolean;
}) {
  return prisma.contractTemplate.create({
    data: {
      code: overrides.code,
      contractType: overrides.contractType ?? 'FIRST_SIGN',
      name: `${overrides.code} 模板`,
      content: '模板正文占位',
      version: overrides.version ?? 1,
      enabled: overrides.enabled ?? true,
      createdBy: 'system',
    },
  });
}

function contractInput(
  customerId: string,
  overrides: Partial<CreateContractInput> = {},
): CreateContractInput {
  return { contractType: 'FIRST_SIGN', title: '委托代理合同', customerId, ...overrides };
}

test('createContract persists a FIRST_SIGN draft and writes contract.created in one transaction', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);

  // 终审修复轮 F-1 后 paymentTerms 必须是良构计划 JSON（自由文本 create 即 400）；
  // 合计须等于合同金额。
  const paymentTerms = JSON.stringify({
    plans: [{ period: 1, dueDate: '2026-09-01', amount: '12800.50' }],
  });
  const view = await service.createContract(
    contractInput(customer.id, {
      amount: '12800.50',
      paymentTerms,
      startDate: '2026-08-01',
      endDate: '2027-07-31',
      terms: '按阶段交付法律服务',
    }),
  );

  assert.ok(view.id);
  assert.match(view.contractNo, CONTRACT_NO_PATTERN);
  assert.match(view.contractNo, /^FS-HQ-ALL-\d{4}-\d{4}$/);
  assert.equal(view.contractType, 'FIRST_SIGN');
  assert.equal(view.status, 'DRAFT');
  assert.equal(view.customerId, customer.id);
  assert.equal(view.sourceType, 'CUSTOMER');
  assert.equal(view.sourceId, null);
  assert.equal(view.negotiationId, null);
  assert.equal(view.parentContractId, null);
  assert.equal(view.templateCode, null);
  assert.equal(view.templateVersion, null);
  assert.equal(view.amount, '12800.50');
  assert.equal(view.receivedAmount, '0.00');
  assert.equal(view.paymentTerms, paymentTerms);
  assert.deepEqual(view.startDate, new Date('2026-08-01T00:00:00.000Z'));
  assert.deepEqual(view.endDate, new Date('2027-07-31T00:00:00.000Z'));
  assert.equal(view.terms, '按阶段交付法律服务');
  assert.equal(view.version, 1);

  const stored = await prisma.contract.findUniqueOrThrow({ where: { id: view.id } });
  assert.equal(stored.createdBy, userId);
  assert.equal(stored.amount.toFixed(2), '12800.50');

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'CONTRACT', objectId: view.id },
  });
  assert.equal(event.eventType, 'contract.created');
  assert.equal(event.eventVersion, 1);
  assert.equal(event.sourceModule, 'CONTRACT');
  assert.equal(event.operatorUserId, userId);
  assert.deepEqual(event.payload, {
    contractId: view.id,
    contractNo: view.contractNo,
    contractType: 'FIRST_SIGN',
    customerId: customer.id,
    sourceType: 'CUSTOMER',
  });

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'CONTRACT', targetId: view.id, action: 'CONTRACT_CREATE' },
  });
  assert.equal(operationLog.userId, userId);
  assert.ok(!operationLog.newValues?.includes('2026-09-01'), 'audit must not log paymentTerms content');
  assert.ok(!operationLog.newValues?.includes('按阶段交付'), 'audit must not log free-text values');
});

test('createContract numbers all four types with their type code prefixes', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);

  const firstSign = await service.createContract(contractInput(customer.id));
  assert.match(firstSign.contractNo, /^FS-/);

  const formal = await service.createContract(contractInput(customer.id, { contractType: 'FORMAL' }));
  assert.match(formal.contractNo, /^WT-/);

  const riskNotice = await service.createContract(
    contractInput(customer.id, { contractType: 'RISK_NOTICE' }),
  );
  assert.match(riskNotice.contractNo, /^RN-/);

  const supplement = await service.createContract(
    contractInput(customer.id, {
      contractType: 'SUPPLEMENT',
      parentContractId: formal.id,
    }),
  );
  assert.match(supplement.contractNo, /^SA-/);
  assert.equal(supplement.parentContractId, formal.id);
  for (const view of [firstSign, formal, riskNotice, supplement]) {
    assert.match(view.contractNo, CONTRACT_NO_PATTERN);
  }
});

test('createContract enforces the SUPPLEMENT parentContractId rules', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);

  await assert.rejects(
    () => service.createContract(contractInput(customer.id, { contractType: 'SUPPLEMENT' })),
    (error) => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );
  await assert.rejects(
    () =>
      service.createContract(
        contractInput(customer.id, {
          contractType: 'SUPPLEMENT',
          parentContractId: randomUUID(),
        }),
      ),
    (error) => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );

  const voidParent = await createContractFixture({
    customerId: customer.id,
    createdBy: userId,
    status: 'VOID',
  });
  await assert.rejects(
    () =>
      service.createContract(
        contractInput(customer.id, {
          contractType: 'SUPPLEMENT',
          parentContractId: voidParent.id,
        }),
      ),
    (error) => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );

  const terminatedParent = await createContractFixture({
    customerId: customer.id,
    createdBy: userId,
    status: 'TERMINATED',
  });
  await assert.rejects(
    () =>
      service.createContract(
        contractInput(customer.id, {
          contractType: 'SUPPLEMENT',
          parentContractId: terminatedParent.id,
        }),
      ),
    (error) => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );

  const parent = await service.createContract(contractInput(customer.id, { contractType: 'FORMAL' }));
  await assert.rejects(
    () => service.createContract(contractInput(customer.id, { parentContractId: parent.id })),
    (error) => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );

  const supplement = await service.createContract(
    contractInput(customer.id, {
      contractType: 'SUPPLEMENT',
      parentContractId: parent.id,
    }),
  );
  assert.equal(supplement.parentContractId, parent.id);
});

test('createContract snapshots an enabled template and rejects forged or disabled codes', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const template = await createTemplateFixture({ code: 'TPL_ENABLED', version: 3 });
  await createTemplateFixture({ code: 'TPL_DISABLED', enabled: false });
  const service = serviceFor(userId, actor);

  const view = await service.createContract(contractInput(customer.id, { templateCode: template.code }));
  assert.equal(view.templateCode, 'TPL_ENABLED');
  assert.equal(view.templateVersion, 3);

  await assert.rejects(
    () => service.createContract(contractInput(customer.id, { templateCode: 'TPL_FORGED' })),
    (error) => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );
  await assert.rejects(
    () => service.createContract(contractInput(customer.id, { templateCode: 'TPL_DISABLED' })),
    (error) => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );

  const withoutTemplate = await service.createContract(contractInput(customer.id));
  assert.equal(withoutTemplate.templateCode, null);
  assert.equal(withoutTemplate.templateVersion, null);
});

test('createContract enforces the NEGOTIATION source coupling and customer ownership', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const otherCustomer = await createCustomerFixture(userId);
  const negotiator = await createEmployeeFixture('谈案律师');
  const negotiation = await createNegotiationFixture({
    customerId: customer.id,
    negotiatorEmployeeId: negotiator.id,
    createdBy: userId,
    status: 'SIGNED',
  });
  const service = serviceFor(userId, actor, { permissionCodes: [...CONTRACT_PERMISSIONS, 'negotiation.read'] });

  await assert.rejects(
    () => service.createContract(contractInput(customer.id, { sourceType: 'NEGOTIATION' })),
    (error) => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );
  await assert.rejects(
    () =>
      service.createContract(
        contractInput(customer.id, {
          sourceType: 'NEGOTIATION',
          negotiationId: randomUUID(),
        }),
      ),
    (error) => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );
  await assert.rejects(
    () =>
      service.createContract(
        contractInput(otherCustomer.id, {
          sourceType: 'NEGOTIATION',
          negotiationId: negotiation.id,
        }),
      ),
    (error) => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );
  await assert.rejects(
    () => service.createContract(contractInput(customer.id, { negotiationId: negotiation.id })),
    (error) => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );

  const view = await service.createContract(
    contractInput(customer.id, {
      sourceType: 'NEGOTIATION',
      negotiationId: negotiation.id,
    }),
  );
  assert.equal(view.sourceType, 'NEGOTIATION');
  assert.equal(view.negotiationId, negotiation.id);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'CONTRACT', objectId: view.id, eventType: 'contract.created' },
  });
  assert.deepEqual(event.payload, {
    contractId: view.id,
    contractNo: view.contractNo,
    contractType: 'FIRST_SIGN',
    customerId: customer.id,
    sourceType: 'NEGOTIATION',
  });
});

test('createContract validates explicit organization anchors and feeds their codes into the number', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const branch = await createOrganizationFixture('ZS01');
  const team = await createTeamFixture('YL', branch.id);
  const service = serviceFor(userId, actor);

  await assert.rejects(
    () => service.createContract(contractInput(customer.id, { branchId: randomUUID() })),
    (error) => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );
  await assert.rejects(
    () => service.createContract(contractInput(customer.id, { professionalTeamId: randomUUID() })),
    (error) => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );
  assert.equal(await prisma.contract.count(), 0);

  const view = await service.createContract(
    contractInput(customer.id, {
      branchId: branch.id,
      professionalTeamId: team.id,
    }),
  );
  assert.equal(view.branchId, branch.id);
  assert.equal(view.professionalTeamId, team.id);
  assert.match(view.contractNo, CONTRACT_NO_PATTERN);
  assert.match(view.contractNo, /^FS-ZS01-YL-\d{4}-\d{4}$/);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'CONTRACT', objectId: view.id },
  });
  assert.equal(event.branchId, branch.id);
  assert.equal(event.teamId, team.id);
});

test('createContract validates amount and projects it with fixed scale', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);

  const numeric = await service.createContract(contractInput(customer.id, { amount: 9600 }));
  assert.equal(numeric.amount, '9600.00');

  const defaulted = await service.createContract(contractInput(customer.id));
  assert.equal(defaulted.amount, '0.00');

  await assert.rejects(
    () => service.createContract(contractInput(customer.id, { amount: 'not-a-number' })),
    (error) => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );
  await assert.rejects(
    () => service.createContract(contractInput(customer.id, { amount: '-5' })),
    (error) => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );
  await assert.rejects(
    () => service.createContract(contractInput(customer.id, { amount: '1.005' })),
    (error) => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );
});

// 终审修复轮 F-1：畸形 paymentTerms 在 create 侧即拒（stuck-SIGNED 根除——无 update API，
// create 预验一次即永真；effect 侧校验不变构成双闸，见下方 effectContract 用例）。
test('createContract rejects malformed paymentTerms with RECEIVABLE_PLAN_MISMATCH 400 and writes nothing', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);

  const cases: Array<{ label: string; input: Partial<CreateContractInput> }> = [
    {
      label: 'malformed JSON',
      input: { amount: '12000.00', paymentTerms: '{not-json' },
    },
    {
      label: 'non-conforming structure',
      input: { amount: '12000.00', paymentTerms: '{"items":[]}' },
    },
    {
      label: 'non-consecutive periods',
      input: {
        amount: '12000.00',
        paymentTerms: JSON.stringify({
          plans: [
            { period: 1, dueDate: '2026-09-01', amount: '6000.00' },
            { period: 3, dueDate: '2026-10-01', amount: '6000.00' },
          ],
        }),
      },
    },
    {
      label: 'plan sum differs from the contract amount',
      input: {
        amount: '12000.00',
        paymentTerms: JSON.stringify({
          plans: [
            { period: 1, dueDate: '2026-09-01', amount: '5000.00' },
            { period: 2, dueDate: '2026-10-01', amount: '6000.00' },
          ],
        }),
      },
    },
    {
      // F-2 同轮：裸 new Date() 可解析的非 ISO 形态一并拒绝。
      label: 'non-ISO dueDate',
      input: {
        amount: '12000.00',
        paymentTerms: JSON.stringify({
          plans: [{ period: 1, dueDate: '09/01/2026', amount: '12000.00' }],
        }),
      },
    },
    {
      // 金额缺省视 Decimal(0)（与 schema @default(0) 一致）：零额合同带非零计划即错配。
      label: 'amount omitted is treated as zero',
      input: {
        paymentTerms: JSON.stringify({
          plans: [{ period: 1, dueDate: '2026-09-01', amount: '100.00' }],
        }),
      },
    },
  ];
  for (const { label, input } of cases) {
    await assert.rejects(
      () => service.createContract(contractInput(customer.id, input)),
      (error) =>
        error instanceof ContractError &&
        error.code === CONTRACT_ERROR_CODES.RECEIVABLE_PLAN_MISMATCH &&
        error.httpStatus === 400,
      `${label} must be rejected at create`,
    );
  }
  assert.equal(await prisma.contract.count(), 0, 'rejected creates write zero contracts');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'CONTRACT' } }),
    0,
    'rejected creates write zero events',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'CONTRACT', action: 'CONTRACT_CREATE' } }),
    0,
    'rejected creates write zero audits',
  );
});

test('createContract returns CONTRACT_NOT_FOUND 404 for a missing or invisible customer', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);

  await assert.rejects(
    () => service.createContract(contractInput(randomUUID())),
    (error) =>
      error instanceof ContractError &&
      error.code === CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND &&
      error.httpStatus === 404,
  );

  const employeeA = await createEmployeeFixture('客服A');
  await prisma.user.update({ where: { id: userId }, data: { employeeId: employeeA.id } });
  const foreignCustomer = await createCustomerFixture('someone-else');
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  const scoped = serviceFor(userId, actor, {
    employeeId: employeeA.id,
    scopeIds: [selfScope.id],
  });
  await assert.rejects(
    () => scoped.createContract(contractInput(foreignCustomer.id)),
    (error) =>
      error instanceof ContractError &&
      error.code === CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND &&
      error.httpStatus === 404,
  );

  const ownCustomer = await createCustomerFixture(userId);
  const created = await scoped.createContract(contractInput(ownCustomer.id));
  assert.equal(created.customerId, ownCustomer.id);
});

test('createContract requires the contract.create action permission', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor, { permissionCodes: ['contract.read'] });

  await assert.rejects(
    () => service.createContract(contractInput(customer.id)),
    hasCode('PERMISSION_DENIED'),
  );
  assert.equal(await prisma.contract.count(), 0);
});

test('submitContract routes by type policy: FIRST_SIGN to PENDING_APPROVAL, RISK_NOTICE to PENDING_SIGN', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);

  const firstSign = await service.createContract(contractInput(customer.id));
  const submitted = await service.submitContract(firstSign.id);
  assert.equal(submitted.status, 'PENDING_APPROVAL');
  assert.equal(submitted.submittedBy, userId);
  assert.ok(submitted.submittedAt instanceof Date);
  assert.equal(submitted.version, 2);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'CONTRACT', objectId: firstSign.id, eventType: 'contract.status_changed' },
  });
  assert.equal(event.eventVersion, 1);
  assert.equal(event.sourceModule, 'CONTRACT');
  assert.equal(event.operatorUserId, userId);
  assert.deepEqual(event.payload, {
    contractId: firstSign.id,
    fromStatus: 'DRAFT',
    toStatus: 'PENDING_APPROVAL',
  });

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'CONTRACT', targetId: firstSign.id, action: 'CONTRACT_SUBMIT' },
  });
  assert.equal(operationLog.userId, userId);

  const riskNotice = await service.createContract(
    contractInput(customer.id, { contractType: 'RISK_NOTICE' }),
  );
  const routed = await service.submitContract(riskNotice.id);
  assert.equal(routed.status, 'PENDING_SIGN', 'RISK_NOTICE skips approval by type policy');
});

test('approveContract moves PENDING_APPROVAL to PENDING_SIGN with approver and optional comment', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);
  const created = await service.createContract(contractInput(customer.id));
  await service.submitContract(created.id);

  const approved = await service.approveContract(created.id, { comment: '同意，注意回款节点' });
  assert.equal(approved.status, 'PENDING_SIGN');
  assert.equal(approved.approvedBy, userId);
  assert.ok(approved.approvedAt instanceof Date);
  assert.equal(approved.approvalComment, '同意，注意回款节点');
  assert.equal(approved.version, 3);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'CONTRACT', objectId: created.id, eventType: 'contract.status_changed' },
    orderBy: { createdAt: 'desc' },
  });
  assert.deepEqual(event.payload, {
    contractId: created.id,
    fromStatus: 'PENDING_APPROVAL',
    toStatus: 'PENDING_SIGN',
  });

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'CONTRACT', targetId: created.id, action: 'CONTRACT_APPROVE' },
  });
  assert.ok(operationLog.newValues?.includes('hasComment'));
  assert.ok(!operationLog.newValues?.includes('同意'), 'approvalComment must not leak into audit values');
});

// Task 7 Minor① 补钉（评审路由，Task 8 窗口）：驳回原因残留随"无 comment 的 approve"清除。
test('approveContract without a comment clears the residual rejection comment', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);
  const created = await service.createContract(contractInput(customer.id));
  await service.submitContract(created.id);

  const rejected = await service.rejectContract(created.id, { comment: '条款缺失，退回补充' });
  assert.equal(rejected.approvalComment, '条款缺失，退回补充');

  await service.submitContract(created.id);
  const approved = await service.approveContract(created.id, {});
  assert.equal(approved.status, 'PENDING_SIGN');
  assert.equal(
    approved.approvalComment,
    null,
    'approve without comment clears the residual rejection comment',
  );
});

test('rejectContract requires a comment, returns the contract to DRAFT, and allows resubmission', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);
  const created = await service.createContract(contractInput(customer.id));
  await service.submitContract(created.id);

  await assert.rejects(
    () => service.rejectContract(created.id, { comment: '' }),
    (error) => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );
  const stillPending = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stillPending.status, 'PENDING_APPROVAL');

  const rejected = await service.rejectContract(created.id, { comment: '条款缺失，退回补充' });
  assert.equal(rejected.status, 'DRAFT');
  assert.equal(rejected.approvalComment, '条款缺失，退回补充');

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'CONTRACT', objectId: created.id, eventType: 'contract.status_changed' },
    orderBy: { createdAt: 'desc' },
  });
  assert.deepEqual(event.payload, {
    contractId: created.id,
    fromStatus: 'PENDING_APPROVAL',
    toStatus: 'DRAFT',
  });

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'CONTRACT', targetId: created.id, action: 'CONTRACT_REJECT' },
  });
  assert.ok(!operationLog.newValues?.includes('条款缺失'), 'reject comment must not leak into audit values');

  const resubmitted = await service.submitContract(created.id);
  assert.equal(resubmitted.status, 'PENDING_APPROVAL', 'rejected draft may be submitted again');
});

test('signContract moves PENDING_SIGN to SIGNED with signDate and esign reservation fields', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);
  const created = await service.createContract(contractInput(customer.id));
  await service.submitContract(created.id);
  await service.approveContract(created.id, {});

  const signed = await service.signContract(created.id, {
    signDate: '2026-08-15',
    esignLinkId: 'esign-link-001',
    esignSerialNo: 'SN-2026-0001',
    esignStatus: 'FLOWING',
  });
  assert.equal(signed.status, 'SIGNED');
  assert.deepEqual(signed.signDate, new Date('2026-08-15T00:00:00.000Z'));
  assert.equal(signed.esignLinkId, 'esign-link-001');
  assert.equal(signed.esignSerialNo, 'SN-2026-0001');
  assert.equal(signed.esignStatus, 'FLOWING');
  assert.equal(signed.version, 4);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'CONTRACT', objectId: created.id, eventType: 'contract.status_changed' },
    orderBy: { createdAt: 'desc' },
  });
  assert.deepEqual(event.payload, {
    contractId: created.id,
    fromStatus: 'PENDING_SIGN',
    toStatus: 'SIGNED',
  });

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'CONTRACT', targetId: created.id, action: 'CONTRACT_SIGN' },
  });
  assert.ok(
    !operationLog.newValues?.includes('esign-link-001'),
    'esign identifiers stay out of audit values',
  );

  const defaulted = await service.createContract(contractInput(customer.id, { contractType: 'RISK_NOTICE' }));
  await service.submitContract(defaulted.id);
  const signedDefault = await service.signContract(defaulted.id, {});
  assert.ok(signedDefault.signDate instanceof Date, 'signDate defaults to server now');
});

test('illegal transitions are rejected with CONTRACT_STATE_TRANSITION_INVALID 409', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);
  const created = await service.createContract(contractInput(customer.id));

  await assert.rejects(
    () => service.approveContract(created.id, {}),
    (error) =>
      error instanceof ContractError &&
      error.code === CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID &&
      error.httpStatus === 409,
  );
  await assert.rejects(
    () => service.rejectContract(created.id, { comment: '驳回' }),
    (error) =>
      error instanceof ContractError &&
      error.code === CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID &&
      error.httpStatus === 409,
  );
  await assert.rejects(
    () => service.signContract(created.id, {}),
    (error) =>
      error instanceof ContractError &&
      error.code === CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID &&
      error.httpStatus === 409,
  );

  await service.submitContract(created.id);
  await assert.rejects(
    () => service.submitContract(created.id),
    (error) =>
      error instanceof ContractError &&
      error.code === CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID &&
      error.httpStatus === 409,
  );

  const riskNotice = await service.createContract(
    contractInput(customer.id, { contractType: 'RISK_NOTICE' }),
  );
  await service.submitContract(riskNotice.id);
  await assert.rejects(
    () => service.approveContract(riskNotice.id, {}),
    (error) =>
      error instanceof ContractError &&
      error.code === CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID &&
      error.httpStatus === 409,
    'RISK_NOTICE approve is blocked by the type policy gate',
  );

  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'contract.status_changed', objectId: created.id } }),
    1,
    'failed transitions write no events',
  );
});

test('actions on missing or out-of-scope contracts hide existence as CONTRACT_NOT_FOUND 404', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const employeeA = await createEmployeeFixture('合同专员A');
  const service = serviceFor(userId, actor);
  const created = await service.createContract(contractInput(customer.id));

  await assert.rejects(
    () => service.getContract(randomUUID()),
    (error) =>
      error instanceof ContractError &&
      error.code === CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND &&
      error.httpStatus === 404,
  );

  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  const foreigner = await prisma.user.create({
    data: { username: `contract.foreigner.${randomUUID()}`, password: 'x' },
  });
  const foreignService = serviceFor(
    foreigner.id,
    { actorUserId: foreigner.id },
    {
      employeeId: employeeA.id,
      scopeIds: [selfScope.id],
    },
  );
  await assert.rejects(
    () => foreignService.getContract(created.id),
    hasCode(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND),
  );
  await assert.rejects(
    () => foreignService.submitContract(created.id),
    hasCode(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND),
  );
  await assert.rejects(
    () => foreignService.approveContract(created.id, {}),
    hasCode(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND),
  );
  await assert.rejects(
    () => foreignService.signContract(created.id, {}),
    hasCode(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND),
  );

  const stored = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.status, 'DRAFT', 'out-of-scope actions never mutate the contract');
});

test('concurrent approveContract on the same version has exactly one winner; loser gets VERSION_CONFLICT 409', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);
  const created = await service.createContract(contractInput(customer.id));
  await service.submitContract(created.id);

  // 确定性竞速（R1 先例 negotiation-service.test.ts:591）：第三方事务持 FOR UPDATE 行锁 1s，
  // 两个 approve 事务的 findFirst 均先于任何提交完成（同读 PENDING_APPROVAL v2 并通过状态
  // 门禁），其 updateMany 被行锁阻塞；锁释放后一者提交 version 2→3，另一者（READ COMMITTED
  // 下重评 where）命中 version=3 → count=0 → 钉死 VERSION_CONFLICT 分支。
  const lockHolder = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM contract WHERE id = ${created.id} FOR UPDATE`;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    },
    { timeout: 15000 },
  );
  // 让锁先落定再发起竞速。
  await new Promise((resolve) => setTimeout(resolve, 100));

  const results = await Promise.allSettled([
    service.approveContract(created.id, { comment: '竞速A' }),
    service.approveContract(created.id, { comment: '竞速B' }),
  ]);
  await lockHolder;

  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one approve may win');
  assert.equal(rejected.length, 1, 'the losing approve must fail, never silently overwrite');
  const loser = rejected[0].reason;
  assert.ok(
    loser instanceof MasterDataError && loser.code === 'VERSION_CONFLICT' && loser.status === 409,
    `loser must get VERSION_CONFLICT 409, got ${String(loser)}`,
  );

  const stored = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.status, 'PENDING_SIGN');
  assert.equal(stored.version, 3, 'exactly one approve may commit');
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'contract.status_changed', objectId: created.id } }),
    2,
    'submit + one winning approve only; the loser writes no duplicate event',
  );
  assert.equal(
    await prisma.operationLog.count({
      where: { targetType: 'CONTRACT', targetId: created.id, action: 'CONTRACT_APPROVE' },
    }),
    1,
    'only the winner writes the approve audit',
  );
});

test('listContracts paginates and filters by status, contractType, customerId and keyword', async () => {
  const { userId, actor } = await createActor();
  const customerA = await createCustomerFixture(userId);
  const customerB = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);

  const first = await service.createContract(contractInput(customerA.id, { title: '劳动争议一审代理' }));
  await service.createContract(contractInput(customerA.id, { title: '合同纠纷二审代理' }));
  await service.createContract(
    contractInput(customerB.id, { contractType: 'RISK_NOTICE', title: '风险告知书' }),
  );
  await service.submitContract(first.id);

  const page1 = await service.listContracts({ page: 1, pageSize: 2 });
  assert.equal(page1.total, 3);
  assert.equal(page1.list.length, 2);
  const page2 = await service.listContracts({ page: 2, pageSize: 2 });
  assert.equal(page2.list.length, 1);

  const byStatus = await service.listContracts({ status: 'PENDING_APPROVAL' });
  assert.equal(byStatus.total, 1);
  assert.equal(byStatus.list[0].id, first.id);

  const byType = await service.listContracts({ contractType: 'RISK_NOTICE' });
  assert.equal(byType.total, 1);

  const byCustomer = await service.listContracts({ customerId: customerA.id });
  assert.equal(byCustomer.total, 2);

  const byKeyword = await service.listContracts({ keyword: '劳动争议' });
  assert.equal(byKeyword.total, 1);
  assert.equal(byKeyword.list[0].id, first.id);

  const byNoKeyword = await service.listContracts({ keyword: first.contractNo });
  assert.equal(byNoKeyword.total, 1);
  assert.equal(byNoKeyword.list[0].id, first.id);
});

test('getContract returns the detail', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);
  const created = await service.createContract(contractInput(customer.id));

  const fetched = await service.getContract(created.id);
  assert.equal(fetched.id, created.id);
  assert.equal(fetched.contractNo, created.contractNo);
  assert.equal(fetched.status, 'DRAFT');
});

test('SELF scope anchors Contract.createdBy without leaking existence', async () => {
  const { userId, actor } = await createActor();
  const employeeA = await createEmployeeFixture('合同专员A');
  await prisma.user.update({ where: { id: userId }, data: { employeeId: employeeA.id } });
  const customer = await createCustomerFixture(userId);
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  const own = await createContractFixture({ customerId: customer.id, createdBy: userId });
  const foreign = await createContractFixture({ customerId: customer.id, createdBy: 'someone-else' });

  const scoped = serviceFor(userId, actor, {
    employeeId: employeeA.id,
    scopeIds: [selfScope.id],
  });
  const page = await scoped.listContracts({});
  assert.deepEqual(
    page.list.map((item) => item.id),
    [own.id],
  );
  assert.equal(page.total, 1);

  const fetched = await scoped.getContract(own.id);
  assert.equal(fetched.id, own.id);
  await assert.rejects(
    () => scoped.getContract(foreign.id),
    hasCode(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND),
  );
});

test('TEAM scope anchors on Contract.professionalTeamId', async () => {
  const { userId, actor } = await createActor();
  const branch = await createOrganizationFixture('BRANCH_TEAM');
  const team = await createTeamFixture(
    `TEAM_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`,
    branch.id,
  );
  const otherTeam = await createTeamFixture(
    `TEAM_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`,
    branch.id,
  );
  const teamScope = await prisma.dataScope.create({
    data: { name: `team-${randomUUID()}`, scopeType: 'TEAM', professionalTeamId: team.id },
  });
  const customer = await createCustomerFixture(userId);
  const inTeam = await createContractFixture({
    customerId: customer.id,
    createdBy: 'someone-else',
    professionalTeamId: team.id,
  });
  const inOtherTeam = await createContractFixture({
    customerId: customer.id,
    createdBy: 'someone-else',
    professionalTeamId: otherTeam.id,
  });

  const scoped = serviceFor(userId, actor, { scopeIds: [teamScope.id] });
  const page = await scoped.listContracts({});
  assert.deepEqual(
    page.list.map((item) => item.id),
    [inTeam.id],
  );
  assert.equal(page.total, 1);
  await assert.rejects(
    () => scoped.getContract(inOtherTeam.id),
    hasCode(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND),
  );
});

test('BRANCH scope anchors on Contract.branchId including the organization subtree', async () => {
  const { userId, actor } = await createActor();
  const branch = await createOrganizationFixture('BRANCH_MAIN');
  const branchChild = await createOrganizationFixture('BRANCH_CHILD', branch);
  const other = await createOrganizationFixture('BRANCH_OTHER');
  const clerk = await createEmployeeInOrg(branch.id, '分所员工');
  const branchScope = await prisma.dataScope.create({
    data: { name: `branch-${randomUUID()}`, scopeType: 'BRANCH', organizationId: branch.id },
  });
  const customer = await createCustomerFixture(userId);
  const inBranch = await createContractFixture({
    customerId: customer.id,
    createdBy: 'someone-else',
    branchId: branch.id,
  });
  const inChild = await createContractFixture({
    customerId: customer.id,
    createdBy: 'someone-else',
    branchId: branchChild.id,
  });
  const outOfBranch = await createContractFixture({
    customerId: customer.id,
    createdBy: 'someone-else',
    branchId: other.id,
  });

  const scoped = serviceFor(userId, actor, { employeeId: clerk.id, scopeIds: [branchScope.id] });
  const page = await scoped.listContracts({});
  assert.deepEqual(page.list.map((item) => item.id).sort(), [inBranch.id, inChild.id].sort());
  assert.equal(page.total, 2);
  await assert.rejects(
    () => scoped.getContract(outOfBranch.id),
    hasCode(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND),
  );
});

test('ORG scope anchors on the exact organization without descendants', async () => {
  const { userId, actor } = await createActor();
  const org = await createOrganizationFixture('ORG_MAIN');
  const orgChild = await createOrganizationFixture('ORG_CHILD', org);
  const clerk = await createEmployeeInOrg(org.id, '机构员工');
  const orgScope = await prisma.dataScope.create({
    data: { name: `org-${randomUUID()}`, scopeType: 'ORG', organizationId: org.id },
  });
  const customer = await createCustomerFixture(userId);
  const inOrg = await createContractFixture({
    customerId: customer.id,
    createdBy: 'someone-else',
    branchId: org.id,
  });
  const inChild = await createContractFixture({
    customerId: customer.id,
    createdBy: 'someone-else',
    branchId: orgChild.id,
  });

  const scoped = serviceFor(userId, actor, { employeeId: clerk.id, scopeIds: [orgScope.id] });
  const page = await scoped.listContracts({});
  assert.deepEqual(
    page.list.map((item) => item.id),
    [inOrg.id],
  );
  assert.equal(page.total, 1);
  await assert.rejects(
    () => scoped.getContract(inChild.id),
    hasCode(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND),
  );
});

test('a context without any matching scope target fails closed', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  await createContractFixture({
    customerId: customer.id,
    createdBy: 'someone-else',
    branchId: (await createOrganizationFixture('BRANCH_MAIN')).id,
  });
  const unrelatedScope = await prisma.dataScope.create({
    data: {
      name: `team-${randomUUID()}`,
      scopeType: 'TEAM',
      professionalTeamId: (
        await createTeamFixture(
          `TEAM_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`,
          (await createOrganizationFixture('BRANCH_TEAM')).id,
        )
      ).id,
    },
  });

  const scoped = serviceFor(userId, actor, { scopeIds: [unrelatedScope.id] });
  const page = await scoped.listContracts({});
  assert.equal(page.total, 0);
  assert.deepEqual(page.list, []);
});

// ==================== Task 8: 生效事务矩阵 + 终止/作废 ====================

const ENGAGEMENT_NO_PATTERN = /^AE\d{6}-[A-Z0-9]{6}$/;
const CASE_NO_PATTERN = /^CA\d{6}-[A-Z0-9]{6}$/;

/** 快捷把需审批合同推进到 SIGNED（submit→approve→sign）。 */
async function driveToSigned(service: ContractService, id: string) {
  await service.submitContract(id);
  await service.approveContract(id, {});
  return service.signContract(id, {});
}

test('effectContract makes a FIRST_SIGN contract EFFECTIVE with default plan, engagement, event and audit in one transaction', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);
  const created = await service.createContract(contractInput(customer.id, { amount: '12800.50' }));
  await driveToSigned(service, created.id);

  const view = await service.effectContract(created.id, { effectiveDate: '2026-09-01' });
  assert.equal(view.status, 'EFFECTIVE');
  assert.deepEqual(view.effectiveDate, new Date('2026-09-01T00:00:00.000Z'));
  assert.equal(view.version, 5, 'create/submit/approve/sign/effect each bump once');

  const plans = await prisma.paymentPlan.findMany({ where: { contractId: created.id } });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].period, 1);
  assert.equal(plans[0].amount.toFixed(2), '12800.50');
  assert.deepEqual(
    plans[0].dueDate,
    new Date('2026-10-01T00:00:00.000Z'),
    'default dueDate = effectiveDate + 30 days',
  );
  assert.equal(plans[0].status, 'PENDING');
  assert.equal(plans[0].receivedAmount.toFixed(2), '0.00');
  assert.match(plans[0].planNo, /^PP\d{6}-[A-Z0-9]{6}$/);
  assert.equal(plans[0].createdBy, userId, 'plan createdBy = effect operator');

  const engagement = await prisma.analysisEngagement.findFirstOrThrow({
    where: { contractId: created.id },
  });
  assert.match(engagement.engagementNo, ENGAGEMENT_NO_PATTERN);
  assert.equal(engagement.customerId, customer.id);
  assert.equal(engagement.status, 'PENDING');
  assert.equal(engagement.createdBy, userId);
  assert.equal(
    await prisma.case.count({ where: { contractId: created.id } }),
    0,
    'FIRST_SIGN creates no case',
  );

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'CONTRACT', objectId: created.id, eventType: 'contract.effective' },
  });
  assert.equal(event.eventVersion, 1);
  assert.equal(event.sourceModule, 'CONTRACT');
  assert.equal(event.operatorUserId, userId);
  assert.deepEqual(event.payload, {
    contractId: created.id,
    contractType: 'FIRST_SIGN',
    customerId: customer.id,
    planCount: 1,
    caseId: null,
    engagementId: engagement.id,
  });
  assert.equal(
    await prisma.eventLog.count({
      where: { objectType: 'CONTRACT', objectId: created.id, eventType: 'contract.status_changed' },
    }),
    3,
    'effect emits only contract.effective; status_changed stays at submit/approve/sign',
  );

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'CONTRACT', targetId: created.id, action: 'CONTRACT_EFFECT' },
  });
  assert.equal(operationLog.userId, userId);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.equal(auditValues.contractNo, view.contractNo);
  assert.equal(auditValues.fromStatus, 'SIGNED');
  assert.equal(auditValues.toStatus, 'EFFECTIVE');
  assert.equal(auditValues.planCount, 1);
  assert.equal(auditValues.caseId, null);
  assert.equal(auditValues.engagementId, engagement.id);
});

test('effectContract defaults effectiveDate to server now and derives the default dueDate from it', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);
  const created = await service.createContract(contractInput(customer.id, { amount: '6000.00' }));
  await driveToSigned(service, created.id);

  const view = await service.effectContract(created.id, {});
  assert.equal(view.status, 'EFFECTIVE');
  assert.ok(view.effectiveDate instanceof Date, 'effectiveDate defaults to server now');

  const plan = await prisma.paymentPlan.findFirstOrThrow({ where: { contractId: created.id } });
  assert.equal(
    plan.dueDate.getTime() - (view.effectiveDate as Date).getTime(),
    30 * 24 * 60 * 60 * 1000,
    'default plan dueDate = effectiveDate + 30 days',
  );
});

test('effectContract FORMAL is gated by a signed RISK_NOTICE of the same customer and creates the minimal case', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const otherCustomer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);
  const formal = await service.createContract(
    contractInput(customer.id, {
      contractType: 'FORMAL',
      title: '正式委托代理合同',
      amount: '50000.00',
    }),
  );
  await driveToSigned(service, formal.id);

  // 他人客户已签 RISK_NOTICE 不满足本客户门禁。
  const foreignNotice = await service.createContract(
    contractInput(otherCustomer.id, { contractType: 'RISK_NOTICE' }),
  );
  await service.submitContract(foreignNotice.id);
  await service.signContract(foreignNotice.id, {});
  // 本客户 RISK_NOTICE 仅 PENDING_SIGN（未签）同样不满足。
  const unsignedNotice = await service.createContract(
    contractInput(customer.id, { contractType: 'RISK_NOTICE' }),
  );
  await service.submitContract(unsignedNotice.id);

  await assert.rejects(
    () => service.effectContract(formal.id, { effectiveDate: '2026-09-01' }),
    (error) =>
      error instanceof ContractError &&
      error.code === CONTRACT_ERROR_CODES.RISK_NOTICE_MISSING &&
      error.httpStatus === 409,
  );
  // 整事务回滚：零计划/零案件/零事件/状态仍 SIGNED/版本不变。
  const rolledBack = await prisma.contract.findUniqueOrThrow({ where: { id: formal.id } });
  assert.equal(rolledBack.status, 'SIGNED');
  assert.equal(rolledBack.version, 4);
  assert.equal(rolledBack.effectiveDate, null);
  assert.equal(await prisma.paymentPlan.count({ where: { contractId: formal.id } }), 0);
  assert.equal(await prisma.case.count({ where: { contractId: formal.id } }), 0);
  assert.equal(
    await prisma.eventLog.count({
      where: { objectType: 'CONTRACT', objectId: formal.id, eventType: 'contract.effective' },
    }),
    0,
  );

  await service.signContract(unsignedNotice.id, {});
  const view = await service.effectContract(formal.id, { effectiveDate: '2026-09-01' });
  assert.equal(view.status, 'EFFECTIVE');

  const caseRow = await prisma.case.findFirstOrThrow({ where: { contractId: formal.id } });
  assert.match(caseRow.caseNo, CASE_NO_PATTERN);
  assert.equal(caseRow.title, `${customer.name}-${formal.title}`);
  assert.equal(caseRow.customerId, customer.id);
  assert.equal(caseRow.lawyerId, null, 'case lawyer is unassigned at creation (MOD-008)');
  assert.equal(caseRow.caseType, 'GENERAL');
  assert.equal(caseRow.status, 'PENDING');
  assert.equal(caseRow.fee.toFixed(2), '50000.00');
  assert.equal(
    await prisma.analysisEngagement.count({ where: { contractId: formal.id } }),
    0,
    'FORMAL creates no analysis engagement',
  );

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'CONTRACT', objectId: formal.id, eventType: 'contract.effective' },
  });
  assert.deepEqual(event.payload, {
    contractId: formal.id,
    contractType: 'FORMAL',
    customerId: customer.id,
    planCount: 1,
    caseId: caseRow.id,
    engagementId: null,
  });
});

test('effectContract SUPPLEMENT generates only its own plans without touching the parent contract', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);
  const parent = await service.createContract(contractInput(customer.id, { contractType: 'FORMAL' }));
  const supplement = await service.createContract(
    contractInput(customer.id, {
      contractType: 'SUPPLEMENT',
      parentContractId: parent.id,
      amount: '2000.00',
      paymentTerms: JSON.stringify({
        plans: [
          { period: 1, dueDate: '2026-09-15', amount: '1200.00' },
          { period: 2, dueDate: '2026-10-15', amount: '800.00' },
        ],
      }),
    }),
  );
  await driveToSigned(service, supplement.id);

  const view = await service.effectContract(supplement.id, { effectiveDate: '2026-09-01' });
  assert.equal(view.status, 'EFFECTIVE');

  const plans = await prisma.paymentPlan.findMany({
    where: { contractId: supplement.id },
    orderBy: { period: 'asc' },
  });
  assert.equal(plans.length, 2);
  assert.deepEqual(
    plans.map((plan) => plan.period),
    [1, 2],
  );
  assert.equal(plans[0].amount.toFixed(2), '1200.00');
  assert.equal(plans[1].amount.toFixed(2), '800.00');
  assert.deepEqual(plans[0].dueDate, new Date('2026-09-15T00:00:00.000Z'));
  assert.equal(
    await prisma.paymentPlan.count({ where: { contractId: parent.id } }),
    0,
    'supplement effect never touches parent plans',
  );
  assert.equal(await prisma.case.count({ where: { contractId: supplement.id } }), 0);
  assert.equal(await prisma.analysisEngagement.count({ where: { contractId: supplement.id } }), 0);

  const parentStored = await prisma.contract.findUniqueOrThrow({ where: { id: parent.id } });
  assert.equal(parentStored.status, 'DRAFT', 'supplement effect never touches the parent contract');

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'CONTRACT', objectId: supplement.id, eventType: 'contract.effective' },
  });
  assert.deepEqual(event.payload, {
    contractId: supplement.id,
    contractType: 'SUPPLEMENT',
    customerId: customer.id,
    planCount: 2,
    caseId: null,
    engagementId: null,
  });
});

test('effectContract rejects RISK_NOTICE by the type policy gate and non-SIGNED states with 409', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);

  const riskNotice = await service.createContract(
    contractInput(customer.id, { contractType: 'RISK_NOTICE' }),
  );
  await service.submitContract(riskNotice.id);
  await service.signContract(riskNotice.id, {});
  await assert.rejects(
    () => service.effectContract(riskNotice.id, {}),
    (error) =>
      error instanceof ContractError &&
      error.code === CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID &&
      error.httpStatus === 409,
    'RISK_NOTICE has no effect edge (terminalAtSigned, generatesReceivable=false)',
  );

  const draft = await service.createContract(contractInput(customer.id));
  await assert.rejects(
    () => service.effectContract(draft.id, {}),
    (error) =>
      error instanceof ContractError &&
      error.code === CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID &&
      error.httpStatus === 409,
  );
  assert.equal(await prisma.paymentPlan.count(), 0, 'rejected effects write no plans');
});

test('effectContract replays on an EFFECTIVE contract returning current state without duplicating side effects', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);
  const created = await service.createContract(contractInput(customer.id, { amount: '8800.00' }));
  await driveToSigned(service, created.id);
  const first = await service.effectContract(created.id, { effectiveDate: '2026-09-01' });

  const replayed = await service.effectContract(created.id, { effectiveDate: '2026-12-25' });
  assert.equal(replayed.status, 'EFFECTIVE');
  assert.deepEqual(replayed.effectiveDate, first.effectiveDate, 'replay keeps the first effectiveDate');
  assert.equal(replayed.version, first.version, 'replay performs no write');

  assert.equal(await prisma.paymentPlan.count({ where: { contractId: created.id } }), 1);
  assert.equal(await prisma.analysisEngagement.count({ where: { contractId: created.id } }), 1);
  assert.equal(
    await prisma.eventLog.count({
      where: { objectType: 'CONTRACT', objectId: created.id, eventType: 'contract.effective' },
    }),
    1,
  );
  assert.equal(
    await prisma.operationLog.count({
      where: { targetType: 'CONTRACT', targetId: created.id, action: 'CONTRACT_EFFECT' },
    }),
    1,
  );
});

test('effectContract validates paymentTerms and rolls back everything on mismatch', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);
  const created = await service.createContract(contractInput(customer.id, { amount: '200.00' }));
  await driveToSigned(service, created.id);

  // 终审修复轮 F-1 后畸形 paymentTerms 在 create 即 400——本用例直改存量行模拟 create 闸
  // 之前的遗产数据，钉死 effect 侧第二道闸（校验逻辑不变）。
  await prisma.contract.update({
    where: { id: created.id },
    data: {
      paymentTerms: JSON.stringify({
        plans: [{ period: 1, dueDate: '2026-09-01', amount: '100.00' }],
      }),
    },
  });

  await assert.rejects(
    () => service.effectContract(created.id, { effectiveDate: '2026-09-01' }),
    (error) =>
      error instanceof ContractError &&
      error.code === CONTRACT_ERROR_CODES.RECEIVABLE_PLAN_MISMATCH &&
      error.httpStatus === 400,
  );
  const stored = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.status, 'SIGNED', 'the status flip rolls back with the failed plan validation');
  assert.equal(stored.version, 4);
  assert.equal(stored.effectiveDate, null);
  assert.equal(await prisma.paymentPlan.count({ where: { contractId: created.id } }), 0);
  assert.equal(await prisma.analysisEngagement.count({ where: { contractId: created.id } }), 0);
  assert.equal(
    await prisma.eventLog.count({
      where: { objectType: 'CONTRACT', objectId: created.id, eventType: 'contract.effective' },
    }),
    0,
  );
});

test('effectContract hides missing or out-of-scope contracts as CONTRACT_NOT_FOUND 404', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const employeeA = await createEmployeeFixture('生效专员A');
  const service = serviceFor(userId, actor);
  const created = await service.createContract(contractInput(customer.id));
  await driveToSigned(service, created.id);

  await assert.rejects(
    () => service.effectContract(randomUUID(), {}),
    (error) =>
      error instanceof ContractError &&
      error.code === CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND &&
      error.httpStatus === 404,
  );

  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  const foreigner = await prisma.user.create({
    data: { username: `contract.foreigner.${randomUUID()}`, password: 'x' },
  });
  const foreignService = serviceFor(
    foreigner.id,
    { actorUserId: foreigner.id },
    {
      employeeId: employeeA.id,
      scopeIds: [selfScope.id],
    },
  );
  await assert.rejects(
    () => foreignService.effectContract(created.id, {}),
    hasCode(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND),
  );

  const stored = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.status, 'SIGNED', 'out-of-scope effect never mutates the contract');
  assert.equal(await prisma.paymentPlan.count({ where: { contractId: created.id } }), 0);
});

test('effectContract requires the contract.effect action permission', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);
  const created = await service.createContract(contractInput(customer.id));
  await driveToSigned(service, created.id);

  const denied = serviceFor(userId, actor, {
    permissionCodes: [
      'contract.read',
      'contract.create',
      'contract.submit',
      'contract.approve',
      'contract.sign',
    ],
  });
  await assert.rejects(() => denied.effectContract(created.id, {}), hasCode('PERMISSION_DENIED'));

  const stored = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.status, 'SIGNED');
  assert.equal(await prisma.paymentPlan.count({ where: { contractId: created.id } }), 0);
});

test('concurrent effectContract has exactly one winner with a single plan set, engagement and event', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);
  const created = await service.createContract(contractInput(customer.id, { amount: '9600.00' }));
  await driveToSigned(service, created.id);

  // 确定性竞速（approve 竞速先例：test/contract/contract-service.test.ts 行锁钉法）：
  // 第三方事务持 FOR UPDATE 行锁 1s，两个 effect 事务的 findFirst 均先于任何提交完成
  // （同读 SIGNED v4 并通过状态判定），其 updateMany 被行锁阻塞；锁释放后一者提交
  // version 4→5 并继续副作用，另一者（READ COMMITTED 下重评 where）命中 version=5 →
  // count=0 → VERSION_CONFLICT。先翻转后副作用保证败者零计划/零委托/零事件。
  const lockHolder = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM contract WHERE id = ${created.id} FOR UPDATE`;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    },
    { timeout: 15000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 100));

  const results = await Promise.allSettled([
    service.effectContract(created.id, {}),
    service.effectContract(created.id, {}),
  ]);
  await lockHolder;

  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one effect may win');
  assert.equal(rejected.length, 1, 'the losing effect must fail, never duplicate side effects');
  const loser = rejected[0].reason;
  assert.ok(
    loser instanceof MasterDataError && loser.code === 'VERSION_CONFLICT' && loser.status === 409,
    `loser must get VERSION_CONFLICT 409, got ${String(loser)}`,
  );

  const stored = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.status, 'EFFECTIVE');
  assert.equal(stored.version, 5, 'exactly one effect flip may commit');
  assert.equal(
    await prisma.paymentPlan.count({ where: { contractId: created.id } }),
    1,
    'exactly one plan set',
  );
  assert.equal(
    await prisma.analysisEngagement.count({ where: { contractId: created.id } }),
    1,
    'exactly one engagement',
  );
  assert.equal(
    await prisma.eventLog.count({
      where: { objectType: 'CONTRACT', objectId: created.id, eventType: 'contract.effective' },
    }),
    1,
    'exactly one contract.effective event',
  );
  assert.equal(
    await prisma.operationLog.count({
      where: { targetType: 'CONTRACT', targetId: created.id, action: 'CONTRACT_EFFECT' },
    }),
    1,
    'only the winner writes the effect audit',
  );
});

test('terminateContract moves EFFECTIVE to TERMINATED with reason, event and audit', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);
  const created = await service.createContract(contractInput(customer.id, { amount: '3000.00' }));
  await driveToSigned(service, created.id);
  await service.effectContract(created.id, {});

  const terminated = await service.terminateContract(created.id, { reason: '客户违约停止服务' });
  assert.equal(terminated.status, 'TERMINATED');
  assert.ok(terminated.terminatedAt instanceof Date);
  assert.equal(terminated.terminateReason, '客户违约停止服务');
  assert.equal(terminated.version, 6);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'CONTRACT', objectId: created.id, eventType: 'contract.status_changed' },
    orderBy: { createdAt: 'desc' },
  });
  assert.deepEqual(event.payload, {
    contractId: created.id,
    fromStatus: 'EFFECTIVE',
    toStatus: 'TERMINATED',
  });

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'CONTRACT', targetId: created.id, action: 'CONTRACT_TERMINATE' },
  });
  assert.equal(operationLog.userId, userId);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.equal(auditValues.fromStatus, 'EFFECTIVE');
  assert.equal(auditValues.toStatus, 'TERMINATED');
  assert.equal(auditValues.hasReason, true);
  assert.ok(
    !operationLog.newValues?.includes('客户违约'),
    'terminate reason stays in the business column, out of audit values',
  );

  // SPEC-012 终止-计划联动：终止把未清计划（PENDING/PARTIAL）翻转为 CANCELLED（行保留、非删行），
  // 故计划行计数仍为 1；RECEIVED 计划保持不动，合同 receivedAmount 不变。
  assert.equal(await prisma.paymentPlan.count({ where: { contractId: created.id } }), 1);
});

test('terminateContract requires EFFECTIVE, a non-empty reason and the contract.terminate permission', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);

  const draft = await service.createContract(contractInput(customer.id));
  await assert.rejects(
    () => service.terminateContract(draft.id, { reason: '草稿终止' }),
    (error) =>
      error instanceof ContractError &&
      error.code === CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID &&
      error.httpStatus === 409,
  );

  const signed = await service.createContract(contractInput(customer.id));
  await driveToSigned(service, signed.id);
  await assert.rejects(
    () => service.terminateContract(signed.id, { reason: '签署未生效' }),
    (error) =>
      error instanceof ContractError &&
      error.code === CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID &&
      error.httpStatus === 409,
    'SIGNED is not terminable; only EFFECTIVE is',
  );
  await assert.rejects(
    () => service.terminateContract(signed.id, { reason: '' }),
    (error) => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );

  const denied = serviceFor(userId, actor, {
    permissionCodes: [
      'contract.read',
      'contract.create',
      'contract.submit',
      'contract.approve',
      'contract.sign',
      'contract.effect',
    ],
  });
  await assert.rejects(
    () => denied.terminateContract(signed.id, { reason: '越权' }),
    hasCode('PERMISSION_DENIED'),
  );

  const stored = await prisma.contract.findUniqueOrThrow({ where: { id: signed.id } });
  assert.equal(stored.status, 'SIGNED', 'rejected terminates never mutate the contract');
  assert.equal(stored.terminatedAt, null);
});

test('voidContract voids pre-effect states with reason, event and audit', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);

  const draft = await service.createContract(contractInput(customer.id));
  const voidedDraft = await service.voidContract(draft.id, { reason: '录入错误作废' });
  assert.equal(voidedDraft.status, 'VOID');
  assert.ok(voidedDraft.voidedAt instanceof Date);
  assert.equal(voidedDraft.voidReason, '录入错误作废');

  const pendingApproval = await service.createContract(contractInput(customer.id));
  await service.submitContract(pendingApproval.id);
  const voidedApproval = await service.voidContract(pendingApproval.id, { reason: '审批中撤回' });
  assert.equal(voidedApproval.status, 'VOID');

  const pendingSign = await service.createContract(contractInput(customer.id));
  await service.submitContract(pendingSign.id);
  await service.approveContract(pendingSign.id, {});
  const voidedSign = await service.voidContract(pendingSign.id, { reason: '签署前废止' });
  assert.equal(voidedSign.status, 'VOID');

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'CONTRACT', objectId: pendingSign.id, eventType: 'contract.status_changed' },
    orderBy: { createdAt: 'desc' },
  });
  assert.deepEqual(event.payload, {
    contractId: pendingSign.id,
    fromStatus: 'PENDING_SIGN',
    toStatus: 'VOID',
  });

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'CONTRACT', targetId: pendingSign.id, action: 'CONTRACT_VOID' },
  });
  assert.equal(operationLog.userId, userId);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.equal(auditValues.fromStatus, 'PENDING_SIGN');
  assert.equal(auditValues.toStatus, 'VOID');
  assert.equal(auditValues.hasReason, true);
  assert.ok(
    !operationLog.newValues?.includes('签署前废止'),
    'void reason stays in the business column, out of audit values',
  );

  await assert.rejects(
    () => service.voidContract(draft.id, { reason: '终态再作废' }),
    (error) =>
      error instanceof ContractError &&
      error.code === CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID &&
      error.httpStatus === 409,
    'VOID is terminal',
  );
});

test('voidContract rejects SIGNED and EFFECTIVE states, empty reason and missing permission', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const service = serviceFor(userId, actor);

  const signed = await service.createContract(contractInput(customer.id));
  await driveToSigned(service, signed.id);
  await assert.rejects(
    () => service.voidContract(signed.id, { reason: '已签署' }),
    (error) =>
      error instanceof ContractError &&
      error.code === CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID &&
      error.httpStatus === 409,
    'SIGNED is not voidable; only pre-effect states are',
  );

  await service.effectContract(signed.id, {});
  await assert.rejects(
    () => service.voidContract(signed.id, { reason: '已生效' }),
    (error) =>
      error instanceof ContractError &&
      error.code === CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID &&
      error.httpStatus === 409,
  );

  const draft = await service.createContract(contractInput(customer.id));
  await assert.rejects(
    () => service.voidContract(draft.id, { reason: '  ' }),
    (error) => error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400,
  );

  const denied = serviceFor(userId, actor, {
    permissionCodes: [
      'contract.read',
      'contract.create',
      'contract.submit',
      'contract.approve',
      'contract.sign',
    ],
  });
  await assert.rejects(() => denied.voidContract(draft.id, { reason: '越权' }), hasCode('PERMISSION_DENIED'));

  const stored = await prisma.contract.findUniqueOrThrow({ where: { id: draft.id } });
  assert.equal(stored.status, 'DRAFT', 'rejected voids never mutate the contract');
  assert.equal(stored.voidedAt, null);
});

// SPEC-012 Task 2 补钉：CONTRACT_TERMINATE_CONFLICT 错误码 4 点落位（个体常量/聚合成员/HTTP 409）。
test('CONTRACT_TERMINATE_CONFLICT pins the 409 conflict code in the aggregate', () => {
  assert.equal(CONTRACT_TERMINATE_CONFLICT, 'CONTRACT_TERMINATE_CONFLICT');
  assert.equal(CONTRACT_ERROR_CODES.CONTRACT_TERMINATE_CONFLICT, 'CONTRACT_TERMINATE_CONFLICT');
  assert.equal(CONTRACT_ERROR_HTTP_STATUS[CONTRACT_TERMINATE_CONFLICT], 409);
});
