import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('开始初始化种子数据...');

  // 1. 创建基础权限
  const permissions = [
    { code: 'system', name: '系统管理', type: 'MENU' },
    { code: 'user:manage', name: '用户管理', type: 'MENU', parentCode: 'system' },
    { code: 'user:create', name: '新增用户', type: 'BUTTON' },
    { code: 'user:read', name: '查看用户', type: 'BUTTON' },
    { code: 'user:update', name: '编辑用户', type: 'BUTTON' },
    { code: 'user:delete', name: '删除用户', type: 'BUTTON' },
    { code: 'role:manage', name: '角色管理', type: 'MENU', parentCode: 'system' },
    { code: 'role:create', name: '新增角色', type: 'BUTTON' },
    { code: 'role:read', name: '查看角色', type: 'BUTTON' },
    { code: 'role:update', name: '编辑角色', type: 'BUTTON' },
    { code: 'role:delete', name: '删除角色', type: 'BUTTON' },
  ];

  const createdPermissions: any[] = [];
  for (const perm of permissions) {
    const created = await prisma.permission.upsert({
      where: { code: perm.code },
      update: {},
      create: {
        code: perm.code,
        name: perm.name,
        type: perm.type,
      },
    });
    createdPermissions.push(created);
    console.log(`权限已创建: ${perm.code}`);
  }

  // 2. 创建角色
  const adminRole = await prisma.role.upsert({
    where: { name: '超级管理员' },
    update: {},
    create: {
      name: '超级管理员',
      type: 'SYSTEM',
      description: '系统超级管理员，拥有所有权限',
    },
  });

  const managerRole = await prisma.role.upsert({
    where: { name: '管理员' },
    update: {},
    create: {
      name: '管理员',
      type: 'SYSTEM',
      description: '系统管理员',
    },
  });

  console.log('角色已创建');

  // 3. 分配权限给角色
  for (const perm of createdPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: adminRole.id,
          permissionId: perm.id,
        },
      },
      update: {},
      create: {
        roleId: adminRole.id,
        permissionId: perm.id,
      },
    });
  }
  console.log('权限已分配给超级管理员');

  // 4. 创建组织
  const firm = await prisma.organization.upsert({
    where: { id: 'firm-001' },
    update: {},
    create: {
      id: 'firm-001',
      name: '总所',
      type: 'FIRM',
      sort: 1,
    },
  });

  const department = await prisma.organization.upsert({
    where: { id: 'dept-001' },
    update: {},
    create: {
      id: 'dept-001',
      name: '刑事部',
      type: 'DEPARTMENT',
      parentId: firm.id,
      sort: 1,
    },
  });

  console.log('组织已创建');

  // 5. 创建岗位
  const position = await prisma.position.upsert({
    where: { id: 'pos-001' },
    update: {},
    create: {
      id: 'pos-001',
      name: '合伙人',
      orgId: department.id,
      level: 1,
    },
  });

  console.log('岗位已创建');

  // 6. 创建员工
  const employee = await prisma.employee.upsert({
    where: { employeeNo: 'EMP001' },
    update: {},
    create: {
      employeeNo: 'EMP001',
      name: '管理员',
      phone: '13800138000',
      email: 'admin@law.com',
      type: 'PARTNER',
      status: 'FORMAL',
      entryDate: new Date('2020-01-01'),
      orgId: department.id,
      positionId: position.id,
    },
  });

  console.log('员工已创建');

  // 7. 创建用户
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  const user = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: hashedPassword,
      status: 'ENABLED',
      employeeId: employee.id,
    },
  });

  console.log('用户已创建');

  // 8. 分配角色给用户
  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: adminRole.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      roleId: adminRole.id,
    },
  });

  console.log('角色已分配给用户');

  // 9. 创建示例渠道
  await prisma.channel.upsert({
    where: { id: 'channel-001' },
    update: {},
    create: {
      id: 'channel-001',
      name: '百度推广',
      type: 'SEARCH',
      cost: 5000,
    },
  });

  await prisma.channel.upsert({
    where: { id: 'channel-002' },
    update: {},
    create: {
      id: 'channel-002',
      name: '抖音短视频',
      type: 'SHORT_VIDEO',
      cost: 3000,
    },
  });

  console.log('渠道已创建');

  console.log('\n种子数据初始化完成！');
  console.log('默认账号: admin / admin123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
