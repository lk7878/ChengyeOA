import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // 1. 创建组织架构
  const hq = await prisma.organization.create({
    data: {
      name: '总所',
      type: 'FIRM',
      sort: 1,
    },
  });

  const dept1 = await prisma.organization.create({
    data: {
      name: '民事部',
      type: 'DEPARTMENT',
      parentId: hq.id,
      sort: 1,
    },
  });

  // 2. 创建岗位
  const partnerPos = await prisma.position.create({
    data: {
      name: '合伙人',
      orgId: hq.id,
      level: 10,
    },
  });

  const lawyerPos = await prisma.position.create({
    data: {
      name: '主办律师',
      orgId: dept1.id,
      level: 5,
    },
  });

  // 3. 创建员工
  const emp1 = await prisma.employee.create({
    data: {
      employeeNo: 'E001',
      name: '张三',
      phone: '13800138000',
      type: 'PARTNER',
      status: 'FORMAL',
      entryDate: new Date('2020-01-01'),
      orgId: hq.id,
      positionId: partnerPos.id,
    },
  });

  const emp2 = await prisma.employee.create({
    data: {
      employeeNo: 'E002',
      name: '李四',
      phone: '13800138001',
      type: 'SENIOR_LAWYER',
      status: 'FORMAL',
      entryDate: new Date('2021-03-15'),
      orgId: dept1.id,
      positionId: lawyerPos.id,
    },
  });

  // 4. 创建用户
  const hashedPassword = await bcrypt.hash('123456', 10);
  
  const adminUser = await prisma.user.create({
    data: {
      username: 'admin',
      password: hashedPassword,
      status: 'ENABLED',
      employeeId: emp1.id,
    },
  });

  const user2 = await prisma.user.create({
    data: {
      username: 'lawyer1',
      password: hashedPassword,
      status: 'ENABLED',
      employeeId: emp2.id,
    },
  });

  // 5. 创建角色和权限
  const adminRole = await prisma.role.create({
    data: {
      name: '超级管理员',
      type: 'SYSTEM',
      description: '系统超级管理员',
    },
  });

  const lawyerRole = await prisma.role.create({
    data: {
      name: '律师',
      type: 'BUSINESS',
      description: '普通律师角色',
    },
  });

  // 6. 分配角色
  await prisma.userRole.create({
    data: { userId: adminUser.id, roleId: adminRole.id },
  });

  await prisma.userRole.create({
    data: { userId: user2.id, roleId: lawyerRole.id },
  });

  // 7. 创建渠道
  const channel1 = await prisma.channel.create({
    data: {
      name: '百度搜索推广',
      type: 'SEARCH',
      cost: 5000,
    },
  });

  // 8. 创建线索
  const lead1 = await prisma.lead.create({
    data: {
      name: '王五',
      phone: '13900139000',
      channelId: channel1.id,
      intentionLevel: 4,
      status: 'CONTACTED',
      assignedTo: emp2.id,
    },
  });

  // 9. 创建客户
  const customer1 = await prisma.customer.create({
    data: {
      name: '王五',
      phone: '13900139000',
      status: 'INTENT',
      leadId: lead1.id,
    },
  });

  // 10. 创建合同
  const contract1 = await prisma.contract.create({
    data: {
      contractNo: 'C-2026-001',
      title: '离婚纠纷法律服务合同',
      type: 'LITIGATION',
      customerId: customer1.id,
      amount: 30000,
      status: 'SIGNED',
      signDate: new Date('2026-04-01'),
      createdBy: emp1.id,
    },
  });

  // 11. 创建案件
  const case1 = await prisma.case.create({
    data: {
      caseNo: 'CASE-2026-001',
      title: '王五诉赵六离婚纠纷案',
      customerId: customer1.id,
      contractId: contract1.id,
      lawyerId: emp2.id,
      caseType: '离婚纠纷',
      status: 'PROCESSING',
      priority: 'HIGH',
      fee: 30000,
    },
  });

  // 12. 创建收款记录
  await prisma.payment.create({
    data: {
      contractId: contract1.id,
      customerId: customer1.id,
      amount: 15000,
      receivedAmount: 15000,
      status: 'RECEIVED',
      receivedDate: new Date('2026-04-01'),
      paymentMethod: '银行转账',
    },
  });

  console.log('✅ Seed completed!');
  console.log(`  - Organizations: 2`);
  console.log(`  - Positions: 2`);
  console.log(`  - Employees: 2`);
  console.log(`  - Users: 2 (admin/123456, lawyer1/123456)`);
  console.log(`  - Roles: 2`);
  console.log(`  - Channels: 1`);
  console.log(`  - Leads: 1`);
  console.log(`  - Customers: 1`);
  console.log(`  - Contracts: 1`);
  console.log(`  - Cases: 1`);
  console.log(`  - Payments: 1`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
