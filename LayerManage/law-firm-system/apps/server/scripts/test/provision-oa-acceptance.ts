import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createRoleMatrix } from './oa-role-matrix-fixture';
import { provisionOrganizationRoles } from '../../app/application/authorization/organization-role-presets';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { PositionService } from '../../app/application/master-data/position-service';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('Pass --execute to create the requested local acceptance accounts.');
  const db = new PrismaClient();
  try {
    const root = await db.organization.findFirstOrThrow({ where: { type: 'FIRM', status: 'ENABLED' }, orderBy: { level: 'asc' } });
    let branch = await db.organization.findFirst({ where: { type: 'BRANCH', status: 'ENABLED', path: { startsWith: `${root.path}/` } }, orderBy: { sort: 'asc' } });
    if (!branch) {
      const { randomUUID } = await import('node:crypto'); const id = randomUUID();
      branch = await db.organization.create({ data: { id, code: 'OA_ACCEPTANCE_BRANCH', name: '验收分所', type: 'BRANCH', parentId: root.id, path: `${root.path}/${id}`, level: root.level + 1 } });
    }
    const organizations = await db.organization.findMany({ where: { type: { in: ['FIRM', 'BRANCH'] }, status: 'ENABLED' } });
    for (const org of organizations) await db.$transaction(tx => provisionOrganizationRoles(tx, org.id), { timeout: 30000 });
    const accounts = await createRoleMatrix(db, root.id, branch.id, 'oa0927');
    const directory = join(process.env.LOCALAPPDATA!, 'ChengyeOA', 'acceptance', '2026-09-27');
    mkdirSync(directory, { recursive: true });
    // Credentials stay outside the repository and are never printed to logs.
    writeFileSync(join(directory, 'accounts.json'), JSON.stringify({ root: root.name, branch: branch.name, accounts }, null, 2), { mode: 0o600 });
    const owner = accounts[0];
    const workspace = await db.collabWorkspace.create({ data: { organizationId: root.id, name: 'OA角色共享验收0927', ownerId: owner.userId } });
    for (const account of accounts) await db.collabMember.create({ data: { workspaceId: workspace.id, principalId: account.userId, role: account.key === 'SUPER_ADMIN' ? 'OWNER' : 'READER', rowScope: 'ALL' } });
    const base = await db.collabBase.create({ data: { workspaceId: workspace.id, name: '总所与分所共享验证' } });
    await db.driveNode.create({ data: { id: base.id, workspaceId: workspace.id, baseId: base.id, kind: 'BASE', ownerId: owner.userId, createdAt: new Date() } });
    const table = await db.collabTable.create({ data: { baseId: base.id, name: '角色验收', createdBy: owner.userId } });
    const field = await db.collabField.create({ data: { tableId: table.id, name: '测试角色', type: 'TEXT' } });
    await db.collabView.create({ data: { tableId: table.id, name: '全部角色', ownerId: owner.userId, shared: true, isDefault: true } });
    const results = [];
    for (const account of accounts) {
      await db.collabRecord.create({ data: { tableId: table.id, values: { [field.id]: account.username }, createdBy: owner.userId, updatedBy: owner.userId, ownerId: owner.userId } });
      const context = await new AuthorizationContextLoader(db).load(account.userId);
      const positions = await new PositionService(db, { actorUserId: account.userId }, context).list({ organizationId: root.id, includeDescendants: true });
      await new CollaborationService(db, context).baseAccess(base.id);
      results.push({ username: account.username, permissionCount: context.permissionCodes.length, visiblePositions: positions.length, sharedRead: 'PASS' });
    }
    writeFileSync(join(directory, 'verification.json'), JSON.stringify({ workspaceId: workspace.id, results }, null, 2));
    console.log(JSON.stringify({ createdAccounts: accounts.length, credentialFile: join(directory, 'accounts.json'), verificationFile: join(directory, 'verification.json'), workspaceId: workspace.id }));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
