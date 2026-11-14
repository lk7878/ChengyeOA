import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { ORGANIZATION_ROLE_NAMES, provisionOrganizationRoles } from '../../app/application/authorization/organization-role-presets';

export async function createRoleMatrix(db: PrismaClient, hqId: string, branchId: string, prefix: string) {
  const accounts: Array<{ username: string; password: string; userId: string; employeeId: string; organizationId: string; key: string; roleId: string }> = [];
  const superRole = await db.role.upsert({ where: { code: 'SYSTEM_SUPER_ADMIN' }, update: {}, create: { code: 'SYSTEM_SUPER_ADMIN', name: '系统超级管理员', type: 'SYSTEM' } });
  for (const [location, organizationId] of [['hq', hqId], ['branch', branchId]]) {
    const roles = await db.$transaction(tx => provisionOrganizationRoles(tx, organizationId), { timeout: 30000 });
    for (const key of ['SUPER_ADMIN', ...Object.keys(ORGANIZATION_ROLE_NAMES)]) {
      const username = `${prefix}_${location}_${key.toLowerCase()}`;
      const password = `Oa!${randomBytes(18).toString('base64url')}7x`;
      const roleId = key === 'SUPER_ADMIN' ? superRole.id : roles[key];
      const label = key === 'SUPER_ADMIN' ? '超级管理员' : ORGANIZATION_ROLE_NAMES[key as keyof typeof ORGANIZATION_ROLE_NAMES];
      const position = await db.position.create({ data: { organizationId, code: username, name: `验收·${label}`, categoryCode: 'ADMIN', level: key === 'SUPER_ADMIN' ? 10 : 1 } });
      const employee = await db.employee.create({ data: { employeeNo: username.toUpperCase().slice(0,32), name: `验收·${location === 'hq' ? '总所' : '分所'}·${label}`, phone: '13800000000', type: key === 'SUPER_ADMIN' || key === 'BRANCH_ADMIN' ? 'ADMIN' : key === 'RECEPTION' ? 'OPERATOR' : key === 'LAWYER' ? 'JUNIOR_LAWYER' : key, status: 'FORMAL', entryDate: new Date('2026-01-01') } });
      await db.employeeAssignment.create({ data: { employeeId: employee.id, organizationId, positionId: position.id, assignmentType: 'PRIMARY', startedAt: new Date('2026-01-01') } });
      const user = await db.user.create({ data: { username, password: await bcrypt.hash(password, 10), employeeId: employee.id, status: 'ENABLED' } });
      await db.userRole.create({ data: { userId: user.id, roleId, source: 'PERMANENT', validFrom: new Date('2026-01-01') } });
      accounts.push({ username, password, userId: user.id, employeeId: employee.id, organizationId, key, roleId });
    }
  }
  return accounts;
}
