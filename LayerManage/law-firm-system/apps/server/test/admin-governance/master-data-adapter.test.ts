import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { MasterDataAdapter } from '../../app/application/admin-governance/adapters/master-data-adapter';
import {
  GovernanceExecutionRequest,
} from '../../app/application/admin-governance/adapters/governance-adapter';
import { GovernanceError } from '../../app/domain/admin-governance/governance-errors';
import { GovernedOperationType } from '../../app/domain/admin-governance/governance-types';
import { MasterDataError } from '../../app/domain/master-data/master-data-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let prisma: PrismaClient;
let requesterUserId: string;
let rootId: string;
let branchId: string;

function request(
  operationType: GovernedOperationType,
  targetType: string,
  targetId: string,
  expectedTargetVersion: number,
  payload: Prisma.JsonValue,
): GovernanceExecutionRequest {
  return {
    operationId: `operation-${randomUUID()}`,
    operationType,
    targetType,
    targetId,
    expectedTargetVersion,
    payload,
    requesterUserId,
    reviewerUserId: null,
  };
}

async function execute(adapter: MasterDataAdapter, input: GovernanceExecutionRequest) {
  return prisma.$transaction(tx => adapter.execute(tx, input));
}

function governanceError(code: string, status: number) {
  return (error: unknown) => error instanceof GovernanceError && error.code === code && error.status === status;
}

function masterDataError(code: string) {
  return (error: unknown) => error instanceof MasterDataError && error.code === code;
}

async function createPosition(code = 'LAWYER') {
  return prisma.position.create({ data: {
    organizationId: branchId,
    code,
    name: code,
    categoryCode: 'LEGAL',
    responsibilities: 'Original responsibilities',
  } });
}

async function createTeam(code = 'TEAM') {
  return prisma.professionalTeam.create({ data: {
    code,
    name: code,
    categoryCode: 'LEGAL',
    homeOrganizationId: branchId,
    description: 'Original description',
  } });
}

test.before(async () => {
  prisma = createTestPrisma();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  const requester = await prisma.user.create({ data: {
    username: `master-governance.${randomUUID()}`,
    password: 'unused',
  } });
  requesterUserId = requester.id;
  rootId = randomUUID();
  branchId = randomUUID();
  await prisma.organization.create({ data: {
    id: rootId, code: 'ROOT', name: 'Root', type: 'FIRM', path: `/${rootId}`,
  } });
  await prisma.organization.create({ data: {
    id: branchId, code: 'BRANCH', name: 'Branch', type: 'BRANCH', parentId: rootId,
    path: `/${rootId}/${branchId}`, level: 1, sort: 1,
  } });
  await prisma.systemInitialization.create({ data: {
    id: 'PRIMARY', rootOrganizationId: rootId, superAdminUserId: requester.id, completedAt: new Date(),
  } });
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

test('supports only master-data operations and validates exact white-listed payloads', async () => {
  const adapter = new MasterDataAdapter();
  assert.equal(adapter.key, 'master-data');
  assert.equal(adapter.supports('MASTER_DATA_METADATA_CORRECTION'), true);
  assert.equal(adapter.supports('MASTER_DATA_STATUS_CORRECTION'), true);
  assert.equal(adapter.supports('SYSTEM_ADMIN_GRANT'), false);
  assert.deepEqual(adapter.validatePayload('MASTER_DATA_METADATA_CORRECTION', { sort: 7 }), { sort: 7 });
  assert.deepEqual(
    adapter.validatePayload('MASTER_DATA_METADATA_CORRECTION', { responsibilities: '  Review matters  ' }),
    { responsibilities: 'Review matters' },
  );
  assert.deepEqual(
    adapter.validatePayload('MASTER_DATA_METADATA_CORRECTION', { description: null }),
    { description: null },
  );
  assert.deepEqual(adapter.validatePayload('MASTER_DATA_STATUS_CORRECTION', { status: 'DISABLED' }), {
    status: 'DISABLED',
  });

  for (const payload of [
    {},
    { sort: 1, description: 'two fields' },
    { name: 'forbidden' },
    { sort: -1 },
    { responsibilities: 'valid', unknown: true },
  ]) {
    assert.throws(
      () => adapter.validatePayload('MASTER_DATA_METADATA_CORRECTION', payload),
      governanceError('TARGET_NOT_ELIGIBLE', 422),
    );
  }
  assert.throws(
    () => adapter.validatePayload('MASTER_DATA_STATUS_CORRECTION', { status: 'LEAVED' }),
    governanceError('TARGET_NOT_ELIGIBLE', 422),
  );
});

test('executes the three metadata corrections with normalized safe snapshots and audit actors', async () => {
  const adapter = new MasterDataAdapter();
  const position = await createPosition();
  const team = await createTeam();
  const organizationOutcome = await execute(adapter, request(
    'MASTER_DATA_METADATA_CORRECTION', 'ORGANIZATION', branchId, 1, { sort: 23 },
  ));
  const positionOutcome = await execute(adapter, request(
    'MASTER_DATA_METADATA_CORRECTION', 'POSITION', position.id, 1,
    { responsibilities: '  Governance responsibility  ' },
  ));
  const teamOutcome = await execute(adapter, request(
    'MASTER_DATA_METADATA_CORRECTION', 'PROFESSIONAL_TEAM', team.id, 1,
    { description: '  Governance description  ' },
  ));

  assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: branchId } })).sort, 23);
  assert.equal(
    (await prisma.position.findUniqueOrThrow({ where: { id: position.id } })).responsibilities,
    'Governance responsibility',
  );
  assert.equal(
    (await prisma.professionalTeam.findUniqueOrThrow({ where: { id: team.id } })).description,
    'Governance description',
  );
  assert.ok([organizationOutcome, positionOutcome, teamOutcome].every(
    outcome => outcome.resultCode === 'MASTER_DATA_METADATA_CORRECTED',
  ));
  const serialized = JSON.stringify([organizationOutcome, positionOutcome, teamOutcome]);
  assert.equal(/password|token|phone|email|credential/i.test(serialized), false);
  const logs = await prisma.operationLog.findMany({ orderBy: { createdAt: 'asc' } });
  assert.equal(logs.length, 3);
  assert.ok(logs.every(log => log.userId === requesterUserId && log.action === 'UPDATE'));
});

test('executes status corrections through existing organization, position, and team invariants', async () => {
  const adapter = new MasterDataAdapter();
  const organizationOutcome = await execute(adapter, request(
    'MASTER_DATA_STATUS_CORRECTION', 'ORGANIZATION', branchId, 1, { status: 'DISABLED' },
  ));
  await prisma.organization.update({
    where: { id: branchId }, data: { status: 'ENABLED', version: 1 },
  });
  const position = await createPosition('STATUS_POSITION');
  const team = await createTeam('STATUS_TEAM');
  const positionOutcome = await execute(adapter, request(
    'MASTER_DATA_STATUS_CORRECTION', 'POSITION', position.id, 1, { status: 'DISABLED' },
  ));
  const teamOutcome = await execute(adapter, request(
    'MASTER_DATA_STATUS_CORRECTION', 'PROFESSIONAL_TEAM', team.id, 1, { status: 'DISABLED' },
  ));

  assert.equal(organizationOutcome.resultCode, 'MASTER_DATA_STATUS_CORRECTED');
  assert.equal(positionOutcome.resultCode, 'MASTER_DATA_STATUS_CORRECTED');
  assert.equal(teamOutcome.resultCode, 'MASTER_DATA_STATUS_CORRECTED');
  assert.equal(JSON.stringify(organizationOutcome.beforeSnapshot).includes('ENABLED'), true);
  assert.equal(JSON.stringify(teamOutcome.afterSnapshot).includes('DISABLED'), true);
});

test('rejects Employee, mismatched white-list fields, unknown targets, and stale versions', async () => {
  const adapter = new MasterDataAdapter();
  const position = await createPosition();
  await assert.rejects(
    () => execute(adapter, request('MASTER_DATA_STATUS_CORRECTION', 'EMPLOYEE', 'employee-1', 1, { status: 'DISABLED' })),
    governanceError('TARGET_NOT_ELIGIBLE', 422),
  );
  await assert.rejects(
    () => execute(adapter, request('MASTER_DATA_METADATA_CORRECTION', 'POSITION', position.id, 1, { sort: 9 })),
    governanceError('TARGET_NOT_ELIGIBLE', 422),
  );
  await assert.rejects(
    () => execute(adapter, request('MASTER_DATA_METADATA_CORRECTION', 'ORGANIZATION', 'missing', 1, { sort: 9 })),
    masterDataError('ORGANIZATION_NOT_FOUND'),
  );
  await assert.rejects(
    () => execute(adapter, request('MASTER_DATA_METADATA_CORRECTION', 'POSITION', position.id, 2, {
      responsibilities: null,
    })),
    governanceError('STALE_TARGET_VERSION', 409),
  );
});

test('preserves root, dependency, and active-member protections', async () => {
  const adapter = new MasterDataAdapter();
  await assert.rejects(
    () => execute(adapter, request('MASTER_DATA_STATUS_CORRECTION', 'ORGANIZATION', rootId, 1, {
      status: 'DISABLED',
    })),
    masterDataError('TRUST_ROOT_PROTECTED'),
  );
  const position = await createPosition('IN_USE_POSITION');
  const employee = await prisma.employee.create({ data: {
    employeeNo: 'EMP-001', name: 'Employee', phone: '13800000000', type: 'LAWYER',
    entryDate: new Date('2026-01-01T00:00:00.000Z'),
  } });
  await prisma.employeeAssignment.create({ data: {
    employeeId: employee.id,
    organizationId: branchId,
    positionId: position.id,
    assignmentType: 'PRIMARY',
    startedAt: employee.entryDate,
  } });
  await assert.rejects(
    () => execute(adapter, request('MASTER_DATA_STATUS_CORRECTION', 'POSITION', position.id, 1, {
      status: 'DISABLED',
    })),
    masterDataError('MASTER_DATA_IN_USE'),
  );
  const team = await createTeam('IN_USE_TEAM');
  await prisma.professionalTeamMember.create({ data: {
    professionalTeamId: team.id,
    employeeId: employee.id,
    memberRole: 'LAWYER',
    startedAt: new Date('2026-07-21T00:00:00.000Z'),
  } });
  await assert.rejects(
    () => execute(adapter, request('MASTER_DATA_STATUS_CORRECTION', 'PROFESSIONAL_TEAM', team.id, 1, {
      status: 'DISABLED',
    })),
    masterDataError('MASTER_DATA_IN_USE'),
  );
});

test('audit failure rolls back the shared business mutation', async () => {
  const adapter = new MasterDataAdapter();
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION reject_governance_master_audit() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'injected governance master audit failure'; END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER reject_governance_master_audit_trigger
    BEFORE INSERT ON "operation_log"
    FOR EACH ROW EXECUTE FUNCTION reject_governance_master_audit()
  `);
  try {
    await assert.rejects(() => execute(adapter, request(
      'MASTER_DATA_METADATA_CORRECTION', 'ORGANIZATION', branchId, 1, { sort: 99 },
    )));
    const branch = await prisma.organization.findUniqueOrThrow({ where: { id: branchId } });
    assert.equal(branch.sort, 1);
    assert.equal(branch.version, 1);
  } finally {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS reject_governance_master_audit_trigger ON "operation_log"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_governance_master_audit()');
  }
});
