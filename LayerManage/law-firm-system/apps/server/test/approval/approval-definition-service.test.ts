import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';

import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { ApprovalDefinitionService, CreateDefinitionInput } from '../../app/application/approval/approval-definition-service';
import { ImportDefinitionsInput } from '../../app/application/approval/approval-types';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import {
  APPROVAL_ERROR_CODES,
  ApprovalError,
} from '../../app/domain/approval/approval-errors';
import { MasterDataError } from '../../app/domain/master-data/master-data-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-017 Task 1: approval-definition-service 定义管理 CRUD 契约测试。
// 形态镜像 approval-instance-service.test.ts：直建 actor + authorization 上下文桩 +
// isApprovalError 断言助手。4 管理方法（create/update/setStatus/listAll）均 requireAction
// approval.manage（缺码 403）；getActiveDefinition 挂 approval.apply（DISABLED 自动拒 404）。
// 钉死点：create version=1/ACTIVE/createdBy=actor + 审计；code 唯一冲突 400；nodeSchema
// 畸形（空数组/非数组对象）ASSIGNEE_INVALID 400；approverRule/formSchema 畸形 400；update
// 白名单 + version+1 + code/businessType 不可变；setStatus DISABLE→apply 404、ENABLE 恢复；
// listAll 含 DISABLED + code 升序。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/approval/approval-definition-service.test.ts

let prisma: PrismaClient;

const MANAGEMENT_PERMISSIONS: PermissionCode[] = ['approval.manage', 'approval.apply'];

const BASIC_FORM_SCHEMA = {
  fields: [
    { key: 'amount', label: '金额', type: 'number', required: true },
    { key: 'category', label: '类别', type: 'text', required: true },
  ],
};

// SPEC-029：默认 approverRule 用 USER 型（空列表）——import 角色校验（roleCodes 必须存在）不适用于
// 通用夹具；SPEC-029 角色校验用显式 ROLE 规则单独测。createDefinition 断言比较常量本身不受影响。
const BASIC_APPROVER_RULE = { type: 'USER', userIds: [] };

const TWO_NODE_SCHEMA = [
  { name: '部门初审', approverRule: { type: 'ROLE', roleCodes: ['MANAGER'] } },
  { name: '法务终审', approverRule: { type: 'USER', userIds: [] } },
] as unknown as Prisma.InputJsonValue;

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

interface ApprovalContextOverrides {
  permissionCodes?: PermissionCode[];
}

/** 授权上下文桩：grants 的 resource 取 permissionCode 前缀（=catalog.resource，与生产 loader 一致）。 */
function approvalContext(userId: string, overrides: ApprovalContextOverrides = {}): AuthorizationContext {
  const permissionCodes = overrides.permissionCodes ?? MANAGEMENT_PERMISSIONS;
  return {
    userId,
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    grants: permissionCodes.map(permissionCode => ({
      sourceType: 'ROLE' as const,
      sourceId: `${userId}-grant-${permissionCode}`,
      sourceRoleId: 'test-role',
      permissionCode,
      resource: permissionCode.split('.')[0],
      scopeIds: ['ALL'],
      validUntil: null,
    })),
    fieldRules: [],
    permissionCodes,
    evaluatedAt: new Date(),
  };
}

async function createApprovalActor(tag: string): Promise<{ userId: string; actor: AuditActor }> {
  const user = await prisma.user.create({
    data: { username: `defmgmt.${tag}.${randomUUID()}`, password: 'x' },
  });
  return {
    userId: user.id,
    actor: { actorUserId: user.id, requestId: `req-${randomUUID()}` },
  };
}

function definitionServiceFor(
  userId: string,
  actor: AuditActor,
  overrides: ApprovalContextOverrides = {},
): ApprovalDefinitionService {
  return new ApprovalDefinitionService(prisma, actor, approvalContext(userId, overrides));
}

function isApprovalError(code: string, httpStatus: number): (error: unknown) => boolean {
  return error => error instanceof ApprovalError && error.code === code && error.httpStatus === httpStatus;
}

function isValidationFailed400(error: unknown): boolean {
  return error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400;
}

function hasCode(code: string): (error: unknown) => boolean {
  return error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

function validCreateInput(overrides: {
  code?: string;
  name?: string;
  businessType?: CreateDefinitionInput['businessType'];
  formSchema?: Prisma.InputJsonValue;
  approverRule?: Prisma.InputJsonValue;
  nodeSchema?: Prisma.InputJsonValue | null;
} = {}): CreateDefinitionInput {
  return {
    code: overrides.code ?? 'SITE_VISIT',
    name: overrides.name ?? '到访审批',
    businessType: overrides.businessType ?? 'SEAL',
    formSchema: overrides.formSchema ?? (BASIC_FORM_SCHEMA as unknown as Prisma.InputJsonValue),
    approverRule: overrides.approverRule ?? (BASIC_APPROVER_RULE as unknown as Prisma.InputJsonValue),
    nodeSchema: overrides.nodeSchema,
  };
}

/** SPEC-025 导入用例定义快照助手（沿 validCreateInput 同构，+version/status 可选）。 */
function validImportDefinition(overrides: {
  code?: string;
  name?: string;
  businessType?: ImportDefinitionsInput['definitions'][number]['businessType'];
  formSchema?: Prisma.InputJsonValue;
  approverRule?: Prisma.InputJsonValue;
  nodeSchema?: Prisma.InputJsonValue | null;
  version?: number;
  status?: 'ACTIVE' | 'DISABLED';
} = {}): ImportDefinitionsInput['definitions'][number] {
  return {
    code: overrides.code ?? 'SITE_VISIT',
    name: overrides.name ?? '到访审批',
    businessType: overrides.businessType ?? 'SEAL',
    formSchema: overrides.formSchema ?? (BASIC_FORM_SCHEMA as unknown as Prisma.InputJsonValue),
    approverRule: overrides.approverRule ?? (BASIC_APPROVER_RULE as unknown as Prisma.InputJsonValue),
    nodeSchema: overrides.nodeSchema,
    version: overrides.version,
    status: overrides.status,
  };
}

// ==================== createDefinition ====================

test('createDefinition persists a new ACTIVE definition with version 1, createdBy actor, and an audit', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);

  const view = await service.createDefinition(validCreateInput({
    code: 'SITE_VISIT',
    name: '到访审批',
    businessType: 'SEAL',
    nodeSchema: TWO_NODE_SCHEMA,
  }));

  assert.ok(view.id, 'definition id is generated');
  assert.equal(view.code, 'SITE_VISIT');
  assert.equal(view.name, '到访审批');
  assert.equal(view.businessType, 'SEAL');
  assert.equal(view.version, 1);
  assert.equal(view.status, 'ACTIVE');
  assert.deepEqual(view.formSchema, BASIC_FORM_SCHEMA);
  assert.deepEqual(view.approverRule, BASIC_APPROVER_RULE);
  assert.deepEqual(view.nodeSchema, TWO_NODE_SCHEMA);
  assert.ok(view.createdAt instanceof Date);
  assert.ok(view.updatedAt instanceof Date);

  const stored = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'SITE_VISIT' } });
  assert.equal(stored.createdBy, userId);
  assert.equal(stored.version, 1);
  assert.equal(stored.status, 'ACTIVE');
  assert.equal(stored.businessType, 'SEAL');

  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_DEFINITION', targetId: view.id, action: 'APPROVAL_DEFINITION_CREATE' },
  });
  assert.equal(audit.userId, userId);
  const auditValues = JSON.parse(audit.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    definitionId: view.id,
    code: 'SITE_VISIT',
    businessType: 'SEAL',
    version: 1,
    status: 'ACTIVE',
  });
});

test('createDefinition returns APPROVAL_DEFINITION_CODE_CONFLICT 400 for a duplicate code', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  await service.createDefinition(validCreateInput({ code: 'EXPENSE' }));

  await assert.rejects(
    () => service.createDefinition(validCreateInput({ code: 'EXPENSE', name: '重复定义' })),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_DEFINITION_CODE_CONFLICT, 400),
    'a duplicate code is a 400 conflict',
  );
  assert.equal(await prisma.approvalDefinition.count(), 1, 'the conflicting create writes nothing');
});

test('createDefinition rejects a code with lowercase, spaces, or illegal characters with VALIDATION_FAILED 400', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);

  await assert.rejects(
    () => service.createDefinition(validCreateInput({ code: 'expense' })),
    isValidationFailed400,
    'a lowercase code is rejected',
  );
  await assert.rejects(
    () => service.createDefinition(validCreateInput({ code: 'EXPENSE CAT' })),
    isValidationFailed400,
    'a code containing a space is rejected',
  );
  await assert.rejects(
    () => service.createDefinition(validCreateInput({ code: 'EXPENSE-CAT' })),
    isValidationFailed400,
    'a code containing a hyphen is rejected',
  );
  await assert.rejects(
    () => service.createDefinition(validCreateInput({ code: '1EXPENSE' })),
    isValidationFailed400,
    'a code not starting with an uppercase letter is rejected',
  );
  assert.equal(await prisma.approvalDefinition.count(), 0, 'no definition is written for an invalid code');
});

test('createDefinition rejects an empty nodeSchema array with ASSIGNEE_INVALID 400', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);

  await assert.rejects(
    () => service.createDefinition(validCreateInput({ nodeSchema: [] })),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400),
    'an empty nodeSchema array is malformed (SPEC-016 semantics)',
  );
  assert.equal(await prisma.approvalDefinition.count(), 0, 'no definition is written');
});

test('createDefinition rejects a non-array object nodeSchema with ASSIGNEE_INVALID 400', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);

  await assert.rejects(
    () => service.createDefinition(validCreateInput({ nodeSchema: { foo: 'bar' } })),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400),
    'a non-array object nodeSchema is malformed (SPEC-016 minor hardening)',
  );
  assert.equal(await prisma.approvalDefinition.count(), 0, 'no definition is written');
});

test('createDefinition rejects a malformed approverRule with ASSIGNEE_INVALID 400', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);

  await assert.rejects(
    () => service.createDefinition(validCreateInput({
      approverRule: { type: 'MANAGER', userIds: [] },
    })),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400),
    'an unknown rule type is malformed',
  );
  await assert.rejects(
    () => service.createDefinition(validCreateInput({
      approverRule: { type: 'USER' },
    })),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400),
    'a USER rule without userIds is malformed',
  );
  assert.equal(await prisma.approvalDefinition.count(), 0, 'no definition is written');
});

test('createDefinition rejects a malformed formSchema with ASSIGNEE_INVALID 400', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);

  await assert.rejects(
    () => service.createDefinition(validCreateInput({
      formSchema: { fields: 'not-an-array' },
    })),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400),
    'a formSchema whose fields is not an array is malformed',
  );
  await assert.rejects(
    () => service.createDefinition(validCreateInput({
      formSchema: { fields: [{ key: 'amount', label: '金额', type: 'bogus' }] },
    })),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400),
    'a formSchema field with an unknown type is malformed',
  );
  assert.equal(await prisma.approvalDefinition.count(), 0, 'no definition is written');
});

// ==================== SPEC-018 node mode ====================

test('createDefinition and updateDefinition reject an unknown node mode with ASSIGNEE_INVALID 400', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);

  await assert.rejects(
    () => service.createDefinition(validCreateInput({
      nodeSchema: [
        { name: '部门初审', approverRule: { type: 'ROLE', roleCodes: ['MANAGER'] }, mode: 'OTHER' },
      ] as unknown as Prisma.InputJsonValue,
    })),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400),
    'a node mode outside {ANY, ALL} is malformed on create (SPEC-018)',
  );
  assert.equal(await prisma.approvalDefinition.count(), 0, 'no definition is written for an invalid create mode');

  await service.createDefinition(validCreateInput({ code: 'EXPENSE', businessType: 'EXPENSE' }));

  await assert.rejects(
    () => service.updateDefinition('EXPENSE', {
      nodeSchema: [
        { name: '法务终审', approverRule: { type: 'USER', userIds: [] }, mode: 'BOGUS' },
      ] as unknown as Prisma.InputJsonValue,
    }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400),
    'a node mode outside {ANY, ALL} is malformed on update (SPEC-018)',
  );
  const stored = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'EXPENSE' } });
  assert.equal(stored.version, 1, 'a rejected update writes nothing');
});

// ==================== updateDefinition ====================

test('updateDefinition applies the whitelist, bumps version, and refuses code/businessType changes', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  await service.createDefinition(validCreateInput({ code: 'EXPENSE', businessType: 'EXPENSE' }));

  const view = await service.updateDefinition('EXPENSE', {
    name: '费用报销（新）',
    nodeSchema: [
      { name: '财务初审', approverRule: { type: 'ROLE', roleCodes: ['FINANCE'] } },
    ] as unknown as Prisma.InputJsonValue,
  });

  assert.equal(view.code, 'EXPENSE', 'code is immutable');
  assert.equal(view.businessType, 'EXPENSE', 'businessType is immutable');
  assert.equal(view.name, '费用报销（新）');
  assert.equal(view.version, 2, 'update bumps version once');
  assert.equal(view.status, 'ACTIVE');
  assert.deepEqual(view.nodeSchema, [
    { name: '财务初审', approverRule: { type: 'ROLE', roleCodes: ['FINANCE'] } },
  ]);

  const stored = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'EXPENSE' } });
  assert.equal(stored.version, 2);
  assert.equal(stored.businessType, 'EXPENSE');

  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_DEFINITION', targetId: view.id, action: 'APPROVAL_DEFINITION_UPDATE' },
  });
  assert.equal(audit.userId, userId);
  const auditValues = JSON.parse(audit.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues.changedFields, ['name', 'nodeSchema']);
  assert.equal(auditValues.fromVersion, 1);
  assert.equal(auditValues.toVersion, 2);

  await assert.rejects(
    () => service.updateDefinition('EXPENSE', { code: 'OTHER' } as never),
    isValidationFailed400,
    'whitelist rejects a code change',
  );
  await assert.rejects(
    () => service.updateDefinition('EXPENSE', { businessType: 'SEAL' } as never),
    isValidationFailed400,
    'whitelist rejects a businessType change',
  );
});

test('updateDefinition returns APPROVAL_DEFINITION_NOT_FOUND 404 for a missing code', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);

  await assert.rejects(
    () => service.updateDefinition('NOPE', { name: '不存在' }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_DEFINITION_NOT_FOUND, 404),
  );
});

// ==================== M3: nodeSchema 回落 + 空对象更新 ====================

test('createDefinition with omitted or explicit null nodeSchema falls back to a single-node definition', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);

  // 缺省 nodeSchema（undefined）→ 单节点回落。
  const omitted = await service.createDefinition(validCreateInput({
    code: 'OMITTED_SCHEMA',
    nodeSchema: undefined,
  }));
  assert.equal(omitted.code, 'OMITTED_SCHEMA');
  assert.equal(omitted.nodeSchema, null, 'omitted nodeSchema is stored as null');
  assert.equal(omitted.status, 'ACTIVE');
  assert.equal(omitted.version, 1);

  // 显式 null nodeSchema → 同样回落。
  const explicit = await service.createDefinition(validCreateInput({ code: 'NULL_SCHEMA', nodeSchema: null }));
  assert.equal(explicit.nodeSchema, null, 'explicit null nodeSchema is stored as null');
  assert.equal(explicit.version, 1);

  const omittedStored = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'OMITTED_SCHEMA' } });
  assert.equal(omittedStored.nodeSchema, null);
  const explicitStored = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'NULL_SCHEMA' } });
  assert.equal(explicitStored.nodeSchema, null);

  // apply 走顶层 approverRule：getActiveDefinition 正常返回，nodeSchema null + approverRule 原样。
  const active = await service.getActiveDefinition('NULL_SCHEMA');
  assert.equal(active.nodeSchema, null);
  assert.deepEqual(active.approverRule, BASIC_APPROVER_RULE);
});

test('updateDefinition with explicit null nodeSchema falls back to single-node (DbNull)', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  await service.createDefinition(validCreateInput({
    code: 'EXPENSE',
    businessType: 'EXPENSE',
    nodeSchema: TWO_NODE_SCHEMA,
  }));

  const view = await service.updateDefinition('EXPENSE', { nodeSchema: null });

  assert.equal(view.code, 'EXPENSE');
  assert.equal(view.nodeSchema, null, 'explicit null nodeSchema clears the chain');
  assert.equal(view.version, 2, 'update bumps version once');
  const stored = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'EXPENSE' } });
  assert.equal(stored.nodeSchema, null);
});

test('updateDefinition with an empty object only bumps version and changes nothing else', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  const created = await service.createDefinition(validCreateInput({ code: 'EXPENSE', businessType: 'EXPENSE' }));

  const view = await service.updateDefinition('EXPENSE', {});

  assert.equal(view.code, 'EXPENSE');
  assert.equal(view.name, created.name, 'name is unchanged');
  assert.equal(view.businessType, created.businessType, 'businessType is unchanged');
  assert.equal(view.status, created.status, 'status is unchanged');
  assert.equal(view.version, 2, 'empty update still bumps version once');
  assert.deepEqual(view.formSchema, created.formSchema, 'formSchema is unchanged');
  assert.deepEqual(view.approverRule, created.approverRule, 'approverRule is unchanged');
  assert.equal(view.nodeSchema, null, 'nodeSchema is unchanged');

  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_DEFINITION', targetId: view.id, action: 'APPROVAL_DEFINITION_UPDATE' },
  });
  const auditValues = JSON.parse(audit.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues.changedFields, [], 'empty update records no changed fields');
  assert.equal(auditValues.fromVersion, 1);
  assert.equal(auditValues.toVersion, 2);
});

// ==================== setDefinitionStatus ====================

test('setDefinitionStatus DISABLED hides the definition from getActiveDefinition', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  await service.createDefinition(validCreateInput({ code: 'EXPENSE', businessType: 'EXPENSE' }));

  const view = await service.setDefinitionStatus('EXPENSE', 'DISABLED');

  assert.equal(view.status, 'DISABLED');
  assert.equal(view.version, 2, 'status flip bumps version once');

  await assert.rejects(
    () => service.getActiveDefinition('EXPENSE'),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_DEFINITION_NOT_FOUND, 404),
    'a DISABLED definition is not applyable',
  );

  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_DEFINITION', targetId: view.id, action: 'APPROVAL_DEFINITION_STATUS' },
  });
  assert.equal(audit.userId, userId);
  const auditValues = JSON.parse(audit.newValues ?? '{}') as Record<string, unknown>;
  assert.equal(auditValues.fromStatus, 'ACTIVE');
  assert.equal(auditValues.toStatus, 'DISABLED');
  assert.equal(auditValues.version, 2);
});

test('setDefinitionStatus ACTIVE re-enables a definition visible to getActiveDefinition', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  await service.createDefinition(validCreateInput({ code: 'EXPENSE', businessType: 'EXPENSE' }));
  await service.setDefinitionStatus('EXPENSE', 'DISABLED');

  const view = await service.setDefinitionStatus('EXPENSE', 'ACTIVE');

  assert.equal(view.status, 'ACTIVE');
  assert.equal(view.version, 3, 'disable then enable bumps version twice');
  const active = await service.getActiveDefinition('EXPENSE');
  assert.equal(active.code, 'EXPENSE');
  assert.equal(active.status, 'ACTIVE');
  assert.equal(active.version, 3);
});

// ==================== listAllDefinitions ====================

test('listAllDefinitions returns every definition including DISABLED ordered by code ascending', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  await service.createDefinition(validCreateInput({ code: 'TRANSFER', businessType: 'TRANSFER' }));
  await service.createDefinition(validCreateInput({ code: 'LEAVE', businessType: 'LEAVE' }));
  await service.createDefinition(validCreateInput({ code: 'SEAL', businessType: 'SEAL' }));
  await service.setDefinitionStatus('SEAL', 'DISABLED');

  const list = await service.listAllDefinitions();

  assert.equal(list.length, 3);
  assert.deepEqual(list.map(item => item.code), ['LEAVE', 'SEAL', 'TRANSFER'], 'code asc including DISABLED');
  assert.equal(list.find(item => item.code === 'SEAL')!.status, 'DISABLED');
  assert.equal(list.find(item => item.code === 'TRANSFER')!.status, 'ACTIVE');
});

// ==================== requireAction approval.manage ====================

test('all four management methods require the approval.manage action permission', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const denied = definitionServiceFor(userId, actor, { permissionCodes: ['approval.apply'] });

  await assert.rejects(() => denied.createDefinition(validCreateInput()), hasCode('PERMISSION_DENIED'));
  await assert.rejects(() => denied.updateDefinition('EXPENSE', { name: 'x' }), hasCode('PERMISSION_DENIED'));
  await assert.rejects(() => denied.setDefinitionStatus('EXPENSE', 'DISABLED'), hasCode('PERMISSION_DENIED'));
  await assert.rejects(() => denied.listAllDefinitions(), hasCode('PERMISSION_DENIED'));
  assert.equal(await prisma.approvalDefinition.count(), 0, 'no definitions are written without approval.manage');
});

// ==================== SPEC-024 乐观锁 + 组合方法 ====================

test('updateDefinition concurrent competition yields one success and one APPROVAL_STATE_INVALID 409', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  await service.createDefinition(validCreateInput({ code: 'EXPENSE', businessType: 'EXPENSE' }));

  const results = await Promise.allSettled([
    service.updateDefinition('EXPENSE', { name: '并发 A' }),
    service.updateDefinition('EXPENSE', { name: '并发 B' }),
  ]);

  assert.equal(results.length, 2);
  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent update wins');
  assert.equal(rejected.length, 1, 'exactly one concurrent update is rejected');

  const loser = rejected[0] as PromiseRejectedResult;
  assert.ok(loser.reason instanceof ApprovalError, `loser is an ApprovalError, not ${String(loser.reason)}`);
  assert.equal(loser.reason.code, APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID);
  assert.equal(loser.reason.httpStatus, 409);
  assert.equal(loser.reason.message, 'approval definition state changed concurrently');

  const stored = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'EXPENSE' } });
  assert.equal(stored.version, 2, 'the winner applies exactly one update');
});

test('setDefinitionStatus concurrent competition yields one success and one APPROVAL_STATE_INVALID 409', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  await service.createDefinition(validCreateInput({ code: 'EXPENSE', businessType: 'EXPENSE' }));

  const results = await Promise.allSettled([
    service.setDefinitionStatus('EXPENSE', 'DISABLED'),
    service.setDefinitionStatus('EXPENSE', 'DISABLED'),
  ]);

  assert.equal(results.length, 2);
  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent status flip wins');
  assert.equal(rejected.length, 1, 'exactly one concurrent status flip is rejected');

  const loser = rejected[0] as PromiseRejectedResult;
  assert.ok(loser.reason instanceof ApprovalError, `loser is an ApprovalError, not ${String(loser.reason)}`);
  assert.equal(loser.reason.code, APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID);
  assert.equal(loser.reason.httpStatus, 409);
  assert.equal(loser.reason.message, 'approval definition state changed concurrently');

  const stored = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'EXPENSE' } });
  assert.equal(stored.version, 2, 'the winner applies exactly one status flip');
});

test('updateDefinition optimistic-lock audit records fromVersion from the locked read', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  await service.createDefinition(validCreateInput({ code: 'EXPENSE', businessType: 'EXPENSE' }));

  const view = await service.updateDefinition('EXPENSE', { name: '费用（新）' });

  assert.equal(view.version, 2);
  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_DEFINITION', targetId: view.id, action: 'APPROVAL_DEFINITION_UPDATE' },
  });
  const auditValues = JSON.parse(audit.newValues ?? '{}') as Record<string, unknown>;
  assert.equal(auditValues.fromVersion, 1);
  assert.equal(auditValues.toVersion, 2);
});

test('updateDefinitionWithStatus applies update and status in one transaction with version +2 and a merged audit', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  await service.createDefinition(validCreateInput({ code: 'EXPENSE', businessType: 'EXPENSE' }));

  const view = await service.updateDefinitionWithStatus('EXPENSE', {
    name: '费用报销（同体）',
    status: 'DISABLED',
  });

  assert.equal(view.code, 'EXPENSE');
  assert.equal(view.name, '费用报销（同体）');
  assert.equal(view.status, 'DISABLED');
  assert.equal(view.version, 3, 'update + status bumps version twice');

  const stored = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'EXPENSE' } });
  assert.equal(stored.version, 3);
  assert.equal(stored.status, 'DISABLED');
  assert.equal(stored.name, '费用报销（同体）');

  const audits = await prisma.operationLog.findMany({
    where: { targetType: 'APPROVAL_DEFINITION', targetId: view.id },
  });
  assert.equal(audits.length, 2, 'create + one merged audit for the combined call');
  assert.deepEqual(
    audits.map(audit => audit.action).sort(),
    ['APPROVAL_DEFINITION_CREATE', 'APPROVAL_DEFINITION_UPDATE'],
  );

  const merged = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_DEFINITION', targetId: view.id, action: 'APPROVAL_DEFINITION_UPDATE' },
  });
  const mergedValues = JSON.parse(merged.newValues ?? '{}') as Record<string, unknown>;
  assert.equal(mergedValues.fromVersion, 1);
  assert.equal(mergedValues.toVersion, 3);
  assert.deepEqual(mergedValues.changedFields, ['name']);
  assert.equal(mergedValues.fromStatus, 'ACTIVE');
  assert.equal(mergedValues.toStatus, 'DISABLED');
});

test('updateDefinitionWithStatus supports update-only and status-only inputs and rejects an empty input', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  await service.createDefinition(validCreateInput({ code: 'EXPENSE', businessType: 'EXPENSE' }));
  await service.createDefinition(validCreateInput({ code: 'LEAVE', businessType: 'LEAVE' }));

  // 仅 update：version +1、status 不变、审计为 UPDATE。
  const updateOnly = await service.updateDefinitionWithStatus('EXPENSE', { name: '费用（新）' });
  assert.equal(updateOnly.name, '费用（新）');
  assert.equal(updateOnly.status, 'ACTIVE');
  assert.equal(updateOnly.version, 2, 'update-only bumps version once');
  const updateOnlyAudits = await prisma.operationLog.findMany({
    where: { targetType: 'APPROVAL_DEFINITION', targetId: updateOnly.id },
  });
  assert.equal(updateOnlyAudits.length, 2, 'create + one merged update audit');
  const updateOnlyAudit = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_DEFINITION', targetId: updateOnly.id, action: 'APPROVAL_DEFINITION_UPDATE' },
  });
  const updateOnlyValues = JSON.parse(updateOnlyAudit.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(updateOnlyValues.changedFields, ['name']);
  assert.equal(updateOnlyValues.fromVersion, 1);
  assert.equal(updateOnlyValues.toVersion, 2);
  assert.ok(!('fromStatus' in updateOnlyValues), 'update-only audit has no status segment');

  // 仅 status：version +1、name 不变、审计为 STATUS。
  const statusOnly = await service.updateDefinitionWithStatus('LEAVE', { status: 'DISABLED' });
  assert.equal(statusOnly.status, 'DISABLED');
  assert.equal(statusOnly.name, '到访审批', 'name is unchanged for a status-only call');
  assert.equal(statusOnly.version, 2, 'status-only bumps version once');
  const statusOnlyAudits = await prisma.operationLog.findMany({
    where: { targetType: 'APPROVAL_DEFINITION', targetId: statusOnly.id },
  });
  assert.equal(statusOnlyAudits.length, 2, 'create + one merged status audit');
  const statusOnlyAudit = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'APPROVAL_DEFINITION', targetId: statusOnly.id, action: 'APPROVAL_DEFINITION_STATUS' },
  });
  const statusOnlyValues = JSON.parse(statusOnlyAudit.newValues ?? '{}') as Record<string, unknown>;
  assert.equal(statusOnlyValues.fromStatus, 'ACTIVE');
  assert.equal(statusOnlyValues.toStatus, 'DISABLED');
  assert.equal(statusOnlyValues.fromVersion, 1);
  assert.equal(statusOnlyValues.toVersion, 2);

  // 空 input：至少一项 → 400。
  await assert.rejects(
    () => service.updateDefinitionWithStatus('EXPENSE', {}),
    isValidationFailed400,
    'an empty combined input is rejected',
  );

  // 组合方法同样 requireAction approval.manage。
  const denied = definitionServiceFor(userId, actor, { permissionCodes: ['approval.apply'] });
  await assert.rejects(
    () => denied.updateDefinitionWithStatus('EXPENSE', { name: 'x' }),
    hasCode('PERMISSION_DENIED'),
  );
});

test('updateDefinitionWithStatus concurrent competition yields one success and one APPROVAL_STATE_INVALID 409', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  await service.createDefinition(validCreateInput({ code: 'EXPENSE', businessType: 'EXPENSE' }));

  const results = await Promise.allSettled([
    service.updateDefinitionWithStatus('EXPENSE', { name: '并发 A', status: 'DISABLED' }),
    service.updateDefinitionWithStatus('EXPENSE', { name: '并发 B', status: 'ACTIVE' }),
  ]);

  assert.equal(results.length, 2);
  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent combined call wins');
  assert.equal(rejected.length, 1, 'exactly one concurrent combined call is rejected');

  const loser = rejected[0] as PromiseRejectedResult;
  assert.ok(loser.reason instanceof ApprovalError, `loser is an ApprovalError, not ${String(loser.reason)}`);
  assert.equal(loser.reason.code, APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID);
  assert.equal(loser.reason.httpStatus, 409);
  assert.equal(loser.reason.message, 'approval definition state changed concurrently');

  const stored = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'EXPENSE' } });
  assert.equal(stored.version, 3, 'the winner applies update + status (version +2)');
});

test('updateDefinition and setDefinitionStatus remain regression-free after the optimistic-lock refactor', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  const created = await service.createDefinition(validCreateInput({ code: 'EXPENSE', businessType: 'EXPENSE' }));

  const updated = await service.updateDefinition('EXPENSE', { name: '费用（新）' });
  assert.equal(updated.version, 2);
  assert.equal(updated.status, 'ACTIVE');

  const disabled = await service.setDefinitionStatus('EXPENSE', 'DISABLED');
  assert.equal(disabled.version, 3);
  assert.equal(disabled.status, 'DISABLED');

  const reEnabled = await service.setDefinitionStatus('EXPENSE', 'ACTIVE');
  assert.equal(reEnabled.version, 4);
  assert.equal(reEnabled.status, 'ACTIVE');

  const audits = await prisma.operationLog.findMany({
    where: { targetType: 'APPROVAL_DEFINITION', targetId: created.id },
  });
  assert.deepEqual(
    audits.map(audit => audit.action).sort(),
    [
      'APPROVAL_DEFINITION_CREATE',
      'APPROVAL_DEFINITION_STATUS',
      'APPROVAL_DEFINITION_STATUS',
      'APPROVAL_DEFINITION_UPDATE',
    ],
  );
});

// ==================== SPEC-025 exportDefinitions + importDefinitions ====================

test('exportDefinitions returns every definition including DISABLED ordered by code ascending', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  await service.createDefinition(validCreateInput({ code: 'TRANSFER', businessType: 'TRANSFER' }));
  await service.createDefinition(validCreateInput({ code: 'LEAVE', businessType: 'LEAVE' }));
  await service.createDefinition(validCreateInput({ code: 'SEAL', businessType: 'SEAL' }));
  await service.setDefinitionStatus('SEAL', 'DISABLED');

  const exported = await service.exportDefinitions();

  // SPEC-029：导出为 { schemaVersion, definitions } 包络。
  assert.equal(exported.schemaVersion, 1, 'export carries the current schema version');
  assert.equal(exported.definitions.length, 3);
  assert.deepEqual(
    exported.definitions.map(item => item.code),
    ['LEAVE', 'SEAL', 'TRANSFER'],
    'full export is code-asc including DISABLED',
  );
  const seal = exported.definitions.find(item => item.code === 'SEAL')!;
  assert.equal(seal.status, 'DISABLED');
  assert.equal(seal.version, 2, 'the DISABLED definition keeps its bumped version in the export');
  assert.equal(seal.businessType, 'SEAL');
  assert.ok('nodeSchema' in seal && 'formSchema' in seal && 'approverRule' in seal, 'export rows carry full view fields');
});

test('exportDefinitions supports incremental export filtered by codes and businessType (SPEC-029)', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  await service.createDefinition(validCreateInput({ code: 'TRANSFER', businessType: 'TRANSFER' }));
  await service.createDefinition(validCreateInput({ code: 'LEAVE', businessType: 'LEAVE' }));
  await service.createDefinition(validCreateInput({ code: 'SEAL', businessType: 'SEAL' }));

  const byCodes = await service.exportDefinitions({ codes: ['SEAL', 'LEAVE'] });
  assert.deepEqual(byCodes.definitions.map(item => item.code), ['LEAVE', 'SEAL'], 'codes filter narrows the export');
  assert.equal(byCodes.schemaVersion, 1);

  const byType = await service.exportDefinitions({ businessType: 'SEAL' });
  assert.equal(byType.definitions.length, 1);
  assert.equal(byType.definitions[0].code, 'SEAL', 'businessType filter narrows to the seal definition');

  // codes 非法（空数组/未知 code 不报错仅空结果；空数组 → 400）。
  await assert.rejects(() => service.exportDefinitions({ codes: [] }), isValidationFailed400);
});

test('exportDefinitions requires the approval.manage action permission', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const denied = definitionServiceFor(userId, actor, { permissionCodes: ['approval.apply'] });

  await assert.rejects(() => denied.exportDefinitions(), hasCode('PERMISSION_DENIED'));
});

test('importDefinitions bulk-creates new definitions with version 1, ACTIVE, createdBy actor', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  // SPEC-029 角色校验：TWO_NODE_SCHEMA 的 nodeSchema 节点引用 MANAGER 角色——先供给该角色（测试库无 bootstrap）。
  await prisma.role.create({
    data: {
      name: 'Manager Role', code: 'MANAGER', type: 'BUSINESS', status: 'ENABLED',
      permissions: { create: [] },
    },
  });

  const result = await service.importDefinitions({
    definitions: [
      validImportDefinition({ code: 'EXPENSE', name: '费用报销', businessType: 'EXPENSE' }),
      validImportDefinition({
        code: 'LEAVE',
        name: '请假审批',
        businessType: 'LEAVE',
        nodeSchema: TWO_NODE_SCHEMA,
      }),
    ],
  });

  assert.deepEqual(result, { imported: 2, updated: 0 });
  const stored = await prisma.approvalDefinition.findMany({ orderBy: [{ code: 'asc' }] });
  assert.equal(stored.length, 2);
  assert.equal(stored[0].code, 'EXPENSE');
  assert.equal(stored[0].version, 1);
  assert.equal(stored[0].status, 'ACTIVE');
  assert.equal(stored[0].createdBy, userId);
  assert.deepEqual(stored[0].formSchema, BASIC_FORM_SCHEMA);
  assert.deepEqual(stored[0].approverRule, BASIC_APPROVER_RULE);
  assert.equal(stored[1].code, 'LEAVE');
  assert.equal(stored[1].version, 1);
  assert.equal(stored[1].status, 'ACTIVE');
  assert.deepEqual(stored[1].nodeSchema, TWO_NODE_SCHEMA);
});

test('importDefinitions updates an existing code with version+1 and optional status', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  await service.createDefinition(validCreateInput({ code: 'EXPENSE', businessType: 'EXPENSE', name: '旧名称' }));

  const result = await service.importDefinitions({
    definitions: [
      validImportDefinition({ code: 'EXPENSE', name: '新名称', businessType: 'EXPENSE', status: 'DISABLED' }),
    ],
  });

  assert.deepEqual(result, { imported: 0, updated: 1 });
  assert.equal(await prisma.approvalDefinition.count(), 1, 'no duplicate row is created');
  const stored = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'EXPENSE' } });
  assert.equal(stored.version, 2, 'an import update bumps version exactly once');
  assert.equal(stored.name, '新名称');
  assert.equal(stored.status, 'DISABLED', 'an import update may set status');
  assert.equal(stored.businessType, 'EXPENSE', 'businessType is immutable across an import update');
});

test('importDefinitions is idempotent for the same payload by code', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  const payload: ImportDefinitionsInput = {
    definitions: [validImportDefinition({ code: 'EXPENSE', name: '费用报销', businessType: 'EXPENSE' })],
  };

  const first = await service.importDefinitions(payload);
  const second = await service.importDefinitions(payload);

  assert.deepEqual(first, { imported: 1, updated: 0 });
  assert.deepEqual(second, { imported: 0, updated: 1 }, 'a repeated import upserts instead of duplicating');
  assert.equal(await prisma.approvalDefinition.count(), 1, 're-import keeps a single row per code');
  const stored = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'EXPENSE' } });
  assert.equal(stored.version, 2, 'the second import bumps version once');
});

test('importDefinitions rejects a version precondition mismatch with APPROVAL_STATE_INVALID 409', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  await service.createDefinition(validCreateInput({ code: 'EXPENSE', businessType: 'EXPENSE', name: '原名称' }));

  await assert.rejects(
    () => service.importDefinitions({
      definitions: [
        validImportDefinition({ code: 'EXPENSE', name: '新名称', businessType: 'EXPENSE', version: 99 }),
      ],
    }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID, 409),
    'a provided version differing from the stored version is a 409',
  );

  const stored = await prisma.approvalDefinition.findUniqueOrThrow({ where: { code: 'EXPENSE' } });
  assert.equal(stored.version, 1, 'a version conflict writes nothing');
  assert.equal(stored.name, '原名称');
  const importAudit = await prisma.operationLog.findFirst({
    where: { action: 'APPROVAL_DEFINITION_IMPORT' },
  });
  assert.equal(importAudit, null, 'no import audit is written for a rejected import');
});

test('importDefinitions rolls back the whole transaction when one definition is malformed', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);

  await assert.rejects(
    () => service.importDefinitions({
      definitions: [
        validImportDefinition({ code: 'EXPENSE', name: '费用报销', businessType: 'EXPENSE' }),
        validImportDefinition({
          code: 'LEAVE',
          name: '请假审批',
          businessType: 'LEAVE',
          formSchema: { fields: 'not-an-array' } as unknown as Prisma.InputJsonValue,
        }),
      ],
    }),
    isApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400),
    'a malformed formSchema fails the import',
  );

  assert.equal(await prisma.approvalDefinition.count(), 0, 'the whole import writes nothing');
  assert.equal(await prisma.operationLog.count(), 0, 'no audit is written for a rolled-back import');
});

test('importDefinitions rejects more than 100 definitions with VALIDATION_FAILED 400', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  const definitions = Array.from({ length: 101 }, (_, index) => validImportDefinition({
    code: `CODE_${String(index).padStart(3, '0')}`,
    name: `定义${index}`,
    businessType: 'SEAL',
  }));

  await assert.rejects(
    () => service.importDefinitions({ definitions }),
    isValidationFailed400,
    'an import over the 100-definition cap is a 400',
  );

  assert.equal(await prisma.approvalDefinition.count(), 0, 'an oversized import writes nothing');
});

// ==================== SPEC-029 格式版本 + 关联角色校验 ====================

test('importDefinitions accepts schemaVersion 1 (or omitted) and rejects future versions (SPEC-029)', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  const base = validImportDefinition({ code: 'EXPENSE', name: '费用报销', businessType: 'EXPENSE' });

  // 缺省（旧导出无 schemaVersion）→ 兼容。
  const omitted = await service.importDefinitions({ definitions: [base] });
  assert.deepEqual(omitted, { imported: 1, updated: 0 });

  // 显式 schemaVersion=1 → 兼容。
  const explicit = await service.importDefinitions({ schemaVersion: 1, definitions: [base] });
  assert.deepEqual(explicit, { imported: 0, updated: 1 }, 'the same code upserts on re-import');

  // schemaVersion=2（未来格式）→ 400，零写入。
  await assert.rejects(
    () => service.importDefinitions({ schemaVersion: 2, definitions: [base] }),
    isValidationFailed400,
    'a future schema version is rejected',
  );
});

test('importDefinitions rejects definitions referencing roles that do not exist (SPEC-029)', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);

  // 引用不存在的角色（沿约定业务角色码：BOARD 未供给）。
  await assert.rejects(
    () => service.importDefinitions({
      schemaVersion: 1,
      definitions: [{
        code: 'EXPENSE',
        name: '费用报销',
        businessType: 'EXPENSE',
        formSchema: BASIC_FORM_SCHEMA as unknown as Prisma.InputJsonValue,
        approverRule: { type: 'ROLE', roleCodes: ['BOARD'] } as unknown as Prisma.InputJsonValue,
      }],
    }),
    hasCode('IMPORTED_ROLE_NOT_FOUND'),
    'a definition referencing a missing role is rejected with the specific code',
  );
  assert.equal(await prisma.approvalDefinition.count(), 0, 'the rejected import writes nothing');
});

test('importDefinitions accepts definitions whose referenced roles exist (SPEC-029)', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  // 建一个 ENABLED 角色（沿夹具：直接 prisma.role.create）。
  const role = await prisma.role.create({
    data: {
      name: 'Board Role', code: 'BOARD_OK', type: 'BUSINESS', status: 'ENABLED',
      permissions: { create: [] },
    },
  });

  const result = await service.importDefinitions({
    schemaVersion: 1,
    definitions: [{
      code: 'EXPENSE',
      name: '费用报销',
      businessType: 'EXPENSE',
      formSchema: BASIC_FORM_SCHEMA as unknown as Prisma.InputJsonValue,
      approverRule: { type: 'ROLE', roleCodes: ['BOARD_OK'] } as unknown as Prisma.InputJsonValue,
    }],
  });
  assert.deepEqual(result, { imported: 1, updated: 0 });
  assert.equal(role.code, 'BOARD_OK', 'the referenced role exists and the import proceeds');
});

test('importDefinitions writes an APPROVAL_DEFINITION_IMPORT audit with imported/updated/count/summary', async () => {
  const { userId, actor } = await createApprovalActor('admin');
  const service = definitionServiceFor(userId, actor);
  await service.createDefinition(validCreateInput({ code: 'EXPENSE', businessType: 'EXPENSE', name: '旧名称' }));

  const result = await service.importDefinitions({
    definitions: [
      validImportDefinition({ code: 'EXPENSE', name: '费用报销（新）', businessType: 'EXPENSE' }),
      validImportDefinition({ code: 'LEAVE', name: '请假审批', businessType: 'LEAVE' }),
    ],
  });

  assert.deepEqual(result, { imported: 1, updated: 1 });
  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { action: 'APPROVAL_DEFINITION_IMPORT' },
  });
  assert.equal(audit.userId, userId);
  assert.equal(audit.targetType, 'APPROVAL_DEFINITION');
  const auditValues = JSON.parse(audit.newValues ?? '{}') as Record<string, unknown>;
  assert.equal(auditValues.imported, 1);
  assert.equal(auditValues.updated, 1);
  assert.equal(auditValues.count, 2);
  assert.ok(typeof auditValues.summary === 'string' && auditValues.summary.length > 0, 'summary is a non-empty string');
});
