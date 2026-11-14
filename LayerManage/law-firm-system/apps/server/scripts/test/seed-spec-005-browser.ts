import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { PrismaClient } from '@prisma/client';
import { createGovernanceServices } from '../../app/application/admin-governance/governance-factory';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { BcryptPasswordHasher } from '../../app/domain/security/password-hasher';
import { SecondSuperAdminService } from '../../app/application/system/second-super-admin-service';
import { SystemBootstrapService } from '../../app/application/system/system-bootstrap-service';
import { assertTestDatabaseUrl } from '../../test/helpers/test-database';

const fixtureStepUp = { async consume() {} };
const fixtureAuthorization = (userId: string) => ({
  claims: { userId, sessionId: `fixture-${userId}`, credentialVersion: 1, assuranceLevel: 'MFA' as const },
  token: 'fixture-step-up-token',
});

const USERNAMES = Object.freeze({
  root: 'spec005.root',
  second: 'spec005.second',
  systemAdmin: 'spec005.admin',
});

interface FixtureOutput {
  write(chunk: string): unknown;
}

export interface Spec005BrowserFixtureResult {
  usernames: typeof USERNAMES;
  operationIds: {
    systemAdminGrant: string;
    postReview: string;
    preReview: string;
  };
  targetIds: {
    organization: string;
    position: string;
    professionalTeam: string;
  };
}

export async function seedSpec005BrowserFixture(
  env: NodeJS.ProcessEnv = process.env,
  output: FixtureOutput = process.stdout,
): Promise<Spec005BrowserFixtureResult> {
  const databaseUrl = assertTestDatabaseUrl(env.DATABASE_URL_TEST ?? env.DATABASE_URL ?? '').toString();
  const password = env.SPEC005_BROWSER_PASSWORD;
  if (!password) throw new Error('SPEC005_BROWSER_PASSWORD is required');

  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const hasher = new BcryptPasswordHasher();
    await new SystemBootstrapService(prisma, hasher, { databaseName, hostname: hostname() }).execute({
      organizationName: 'SPEC-005 Browser Firm',
      username: USERNAMES.root,
      password,
    });

    const initialized = await prisma.systemInitialization.findUniqueOrThrow({ where: { id: 'PRIMARY' } });
    const root = await prisma.user.update({
      where: { id: initialized.superAdminUserId },
      data: { mustChangePassword: false, passwordChangedAt: new Date() },
    });
    const passwordHash = await hasher.hash(password);
    const second = await prisma.user.create({ data: {
      username: USERNAMES.second,
      password: passwordHash,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    } });
    const systemAdmin = await prisma.user.create({ data: {
      username: USERNAMES.systemAdmin,
      password: passwordHash,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    } });

    await new SecondSuperAdminService(
      prisma,
      hasher,
      { databaseName, hostname: hostname() },
    ).execute({
      actorUsername: USERNAMES.root,
      actorPassword: password,
      targetUsername: USERNAMES.second,
      reason: 'Create the independent browser acceptance review seat',
      confirmation: `ADD SECOND SUPER ADMIN ${databaseName} ${USERNAMES.second}`,
    });

    const organizationId = randomUUID();
    const organization = await prisma.organization.create({ data: {
      id: organizationId,
      code: 'SPEC005-BRANCH',
      name: 'SPEC-005 Browser Branch',
      type: 'BRANCH',
      parentId: initialized.rootOrganizationId,
      path: `/${initialized.rootOrganizationId}/${organizationId}`,
      level: 1,
      sort: 10,
    } });
    const position = await prisma.position.create({ data: {
      organizationId: organization.id,
      code: 'SPEC005-POSITION',
      name: 'SPEC-005 Browser Position',
      categoryCode: 'LEGAL',
      responsibilities: 'Original browser fixture responsibilities',
    } });
    const professionalTeam = await prisma.professionalTeam.create({ data: {
      code: 'SPEC005-TEAM',
      name: 'SPEC-005 Browser Team',
      categoryCode: 'LEGAL',
      homeOrganizationId: organization.id,
      description: 'Original browser fixture description',
    } });

    const contexts = new AuthorizationContextLoader(prisma);
    const rootContext = await contexts.load(root.id);
    const secondContext = await contexts.load(second.id);
    const governance = createGovernanceServices(prisma, { databaseName, stepUp: fixtureStepUp });
    const systemAdminGrant = await governance.command.create(rootContext, {
      operationType: 'SYSTEM_ADMIN_GRANT',
      targetType: 'USER',
      targetId: systemAdmin.id,
      reason: 'Grant the deterministic browser fixture administrator seat',
      expectedTargetVersion: systemAdmin.credentialVersion,
      payload: { validUntil: null },
      idempotencyKey: randomUUID(),
    }, undefined, fixtureAuthorization(root.id));
    await governance.review.review(secondContext, systemAdminGrant.id, {
      decision: 'APPROVE',
      expectedOperationVersion: systemAdminGrant.version,
    }, undefined, fixtureAuthorization(second.id));

    const systemAdminContext = await contexts.load(systemAdmin.id);
    const postReview = await governance.command.create(systemAdminContext, {
      operationType: 'MASTER_DATA_METADATA_CORRECTION',
      targetType: 'ORGANIZATION',
      targetId: organization.id,
      reason: 'Correct the deterministic browser branch ordering evidence',
      expectedTargetVersion: organization.version,
      payload: { sort: 20 },
      idempotencyKey: randomUUID(),
    });
    const preReview = await governance.command.create(systemAdminContext, {
      operationType: 'MASTER_DATA_STATUS_CORRECTION',
      targetType: 'POSITION',
      targetId: position.id,
      reason: 'Disable the deterministic browser position after independent review',
      expectedTargetVersion: position.version,
      payload: { status: 'DISABLED' },
      idempotencyKey: randomUUID(),
    }, undefined, fixtureAuthorization(systemAdmin.id));

    const result: Spec005BrowserFixtureResult = {
      usernames: USERNAMES,
      operationIds: {
        systemAdminGrant: systemAdminGrant.id,
        postReview: postReview.id,
        preReview: preReview.id,
      },
      targetIds: {
        organization: organization.id,
        position: position.id,
        professionalTeam: professionalTeam.id,
      },
    };
    writeFixtureSummary(output, result);
    return result;
  } finally {
    await prisma.$disconnect();
  }
}

function writeFixtureSummary(output: FixtureOutput, result: Spec005BrowserFixtureResult): void {
  output.write('SPEC-005 browser fixture ready.\n');
  output.write(`Users: ${result.usernames.root}, ${result.usernames.second}, ${result.usernames.systemAdmin}\n`);
  output.write(`System-admin grant operation: ${result.operationIds.systemAdminGrant}\n`);
  output.write(`Post-review operation: ${result.operationIds.postReview}\n`);
  output.write(`Pre-review operation: ${result.operationIds.preReview}\n`);
}

if (require.main === module) {
  void seedSpec005BrowserFixture().catch(error => {
    const message = error instanceof Error && (
      error.message === 'SPEC005_BROWSER_PASSWORD is required'
      || error.message.includes('ending in _test')
    ) ? error.message : 'Fixture creation failed';
    process.stderr.write(`SPEC-005 browser fixture: ${message}.\n`);
    process.exitCode = 1;
  });
}
