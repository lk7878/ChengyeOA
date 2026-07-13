import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

type PermissionDefinition = {
  code: string;
  name: string;
  type: string;
  parentCode?: string;
  sort: number;
};

const permissions: PermissionDefinition[] = [
  { code: 'system', name: 'System', type: 'MENU', parentCode: undefined, sort: 1 },
  { code: 'user:manage', name: 'User Management', type: 'MENU', parentCode: 'system', sort: 1 },
  { code: 'user:create', name: 'Create User', type: 'BUTTON', parentCode: 'user:manage', sort: 1 },
  { code: 'user:read', name: 'Read User', type: 'BUTTON', parentCode: 'user:manage', sort: 2 },
  { code: 'user:update', name: 'Update User', type: 'BUTTON', parentCode: 'user:manage', sort: 3 },
  { code: 'user:delete', name: 'Delete User', type: 'BUTTON', parentCode: 'user:manage', sort: 4 },
  { code: 'role:manage', name: 'Role Management', type: 'MENU', parentCode: 'system', sort: 2 },
  { code: 'role:create', name: 'Create Role', type: 'BUTTON', parentCode: 'role:manage', sort: 1 },
  { code: 'role:read', name: 'Read Role', type: 'BUTTON', parentCode: 'role:manage', sort: 2 },
  { code: 'role:update', name: 'Update Role', type: 'BUTTON', parentCode: 'role:manage', sort: 3 },
  { code: 'role:delete', name: 'Delete Role', type: 'BUTTON', parentCode: 'role:manage', sort: 4 },
];

export async function seed(prisma: PrismaClient, adminPassword: string): Promise<void> {
  const firm = await prisma.organization.upsert({
    where: { id: 'firm-001' },
    update: { name: 'System Firm', type: 'FIRM', parentId: null, sort: 1 },
    create: { id: 'firm-001', name: 'System Firm', type: 'FIRM', sort: 1 },
  });

  const department = await prisma.organization.upsert({
    where: { id: 'dept-001' },
    update: { name: 'System Administration', type: 'DEPARTMENT', parentId: firm.id, sort: 1 },
    create: {
      id: 'dept-001',
      name: 'System Administration',
      type: 'DEPARTMENT',
      parentId: firm.id,
      sort: 1,
    },
  });

  const position = await prisma.position.upsert({
    where: { id: 'pos-001' },
    update: { name: 'System Administrator', orgId: department.id, level: 1 },
    create: { id: 'pos-001', name: 'System Administrator', orgId: department.id, level: 1 },
  });

  const employee = await prisma.employee.upsert({
    where: { employeeNo: 'EMP001' },
    update: {
      name: 'System Administrator',
      phone: '13800138000',
      email: 'admin@law.local',
      type: 'ADMIN',
      status: 'FORMAL',
      entryDate: new Date('2020-01-01T00:00:00.000Z'),
      orgId: department.id,
      positionId: position.id,
    },
    create: {
      employeeNo: 'EMP001',
      name: 'System Administrator',
      phone: '13800138000',
      email: 'admin@law.local',
      type: 'ADMIN',
      status: 'FORMAL',
      entryDate: new Date('2020-01-01T00:00:00.000Z'),
      orgId: department.id,
      positionId: position.id,
    },
  });

  const adminUser = await prisma.user.upsert({
    where: { username: 'admin' },
    update: { status: 'ENABLED', employeeId: employee.id },
    create: {
      username: 'admin',
      password: await bcrypt.hash(adminPassword, 10),
      status: 'ENABLED',
      employeeId: employee.id,
    },
  });

  const adminRole = await prisma.role.upsert({
    where: { name: 'System Administrator' },
    update: { type: 'SYSTEM', description: 'Full system access' },
    create: { name: 'System Administrator', type: 'SYSTEM', description: 'Full system access' },
  });

  await prisma.role.upsert({
    where: { name: 'System Manager' },
    update: { type: 'SYSTEM', description: 'System management role' },
    create: { name: 'System Manager', type: 'SYSTEM', description: 'System management role' },
  });

  const permissionByCode = new Map<string, string>();
  for (const permission of permissions) {
    const parentId = permission.parentCode ? permissionByCode.get(permission.parentCode) : null;
    if (permission.parentCode && !parentId) throw new Error(`Missing parent permission: ${permission.parentCode}`);

    const seededPermission = await prisma.permission.upsert({
      where: { code: permission.code },
      update: { name: permission.name, type: permission.type, parentId, sort: permission.sort },
      create: { code: permission.code, name: permission.name, type: permission.type, parentId, sort: permission.sort },
    });
    permissionByCode.set(permission.code, seededPermission.id);
  }

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
    update: {},
    create: { userId: adminUser.id, roleId: adminRole.id },
  });

  for (const permissionId of permissionByCode.values()) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId } },
      update: {},
      create: { roleId: adminRole.id, permissionId },
    });
  }
}

if (require.main === module) {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) throw new Error('SEED_ADMIN_PASSWORD is required');
  const prisma = new PrismaClient();
  seed(prisma, password)
    .finally(async () => prisma.$disconnect());
}
