import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { CustomerService } from '../../app/application/crm/customer-service';
import { CaseService } from '../../app/application/case/case-service';
import { NegotiationService } from '../../app/application/contract/negotiation-service';
import { ContractService } from '../../app/application/contract/contract-service';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';

let db: PrismaClient;
test.before(async () => {
  db = createTestPrisma();
  await clearTestApplicationData(db);
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

for (const explicitBranch of [true, false])
  test(`new role accounts: create/read/share with explicit branch=${explicitBranch}`, async () => {
    await clearTestApplicationData(db);
    const org = key(),
      foreign = key();
    for (const id of [org, foreign])
      await db.organization.create({
        data: { id, code: id === org ? 'HQ' : 'BRANCH', name: '验收分所', type: 'BRANCH', path: '/' + id },
      });
    const createAccount = async (
      name: string,
      organizationId: string,
      scopeType: string,
      readOnly = false,
      admin = false,
    ) => {
      const employee = await db.employee.create({
        data: {
          employeeNo: key(),
          name,
          phone: '13800000000',
          type: 'LAWYER',
          status: 'FORMAL',
          entryDate: new Date('2020-01-01'),
        },
      });
      const position = await db.position.create({
        data: { code: key(), name, categoryCode: 'LAWYER', organizationId },
      });
      await db.employeeAssignment.create({
        data: {
          employeeId: employee.id,
          organizationId,
          positionId: position.id,
          assignmentType: 'PRIMARY',
          startedAt: new Date('2020-01-01'),
        },
      });
      const user = await db.user.create({
        data: { username: name, password: 'isolated-fixture-no-login', employeeId: employee.id },
      });
      const permissions = readOnly
        ? ['customer.read', 'case.read', 'negotiation.read', 'invoice.read', 'contract.read']
        : [
            'customer.read',
            'customer.create',
            'customer.update',
            'case.read',
            'case.create',
            'case.update',
            'case.delete',
            'negotiation.read',
            'negotiation.create',
            'negotiation.update',
            'invoice.read',
            'contract.read',
            'contract.create',
          ];
      const scope = await db.dataScope.create({
        data: {
          name,
          scopeType,
          organizationId: scopeType === 'BRANCH' ? organizationId : null,
          includeDescendants: true,
        },
      });
      const role = await db.role.create({
        data: {
          code: admin ? 'SYSTEM_SUPER_ADMIN' : name,
          name,
          type: admin ? 'SYSTEM' : 'BUSINESS',
          permissions: { create: permissions.map((code) => ({ permission: { connect: { code } } })) },
          dataScopes: {
            create: ['customer', 'case', 'negotiation', 'contract', 'invoice'].map((resource) => ({
              resource,
              dataScopeId: scope.id,
            })),
          },
        },
      });
      await db.userRole.create({
        data: { userId: user.id, roleId: role.id, source: 'PERMANENT', validFrom: new Date('2020-01-01') },
      });
      const context = await new AuthorizationContextLoader(db).load(user.id);
      const audit = { actorUserId: user.id, requestId: key() };
      return {
        user,
        employee,
        role,
        context,
        customers: new CustomerService(db, audit, context),
        cases: new CaseService(db, audit, context),
        negotiations: new NegotiationService(db, audit, context),
        contracts: new ContractService(db, audit, context),
        collab: new CollaborationService(db, context),
      };
    };
    const admin = await createAccount('qa_admin', org, 'ALL', false, true);
    const manager = await createAccount('qa_branch_manager', org, 'BRANCH');
    const lawyer = await createAccount('qa_self_lawyer', org, 'SELF');
    const reader = await createAccount('qa_read_only', org, 'BRANCH', true);
    const outsider = await createAccount('qa_other_branch', foreign, 'BRANCH');
    const workspace = await admin.collab.createWorkspace({ name: '共享验收', organizationId: org }, key());
    for (const account of [manager, lawyer, reader, outsider])
      await db.collabMember.create({
        data: {
          workspaceId: workspace.id,
          principalType: 'ROLE',
          principalId: account.role.id,
          role: account === reader ? 'READER' : 'EDITOR',
          rowScope: 'ALL',
        },
      });
    const base = await admin.collab.createBase(workspace.id, { name: '共享业务' }, key());
    const tables: Record<string, string> = {};
    for (const source of ['CUSTOMERS', 'CASES', 'NEGOTIATIONS', 'CONTRACTS', 'INVOICES'])
      tables[source] = (await admin.collab.createTable(base.id, { name: source, source }, key())).id;
    const customerIds: string[] = [];
    for (const account of [admin, manager, lawyer, outsider]) {
      const customer = await account.customers.createCustomer({
        name: account.user.username + '客户',
        phone: '13800000000',
      });
      customerIds.push(customer.id);
      assert.equal((await account.customers.getCustomer(customer.id)).id, customer.id);
      const branchId = explicitBranch ? (account === outsider ? foreign : org) : undefined;
      const c = await account.cases.createCase({
        title: '新账号案件',
        customerId: customer.id,
        lawyerId: account.employee.id,
        caseType: '民事',
        branchId,
      });
      const negotiation = await account.negotiations.createNegotiation({
        customerId: customer.id,
        negotiatorEmployeeId: account.employee.id,
        branchId,
      });
      const contract = await account.contracts.createContract({
        contractType: 'FORMAL',
        title: '新账号合同',
        customerId: customer.id,
        branchId,
        amount: '100.00',
      });
      assert.equal((await db.case.findUniqueOrThrow({ where: { id: c.id } })).createdBy, account.user.id);
      assert.equal((await account.cases.getCase(c.id)).id, c.id);
      assert.equal((await account.contracts.getContract(contract.id)).id, contract.id);
      assert.equal((await account.negotiations.getNegotiation(negotiation.id)).id, negotiation.id);
      assert.ok((await account.contracts.listContracts({})).list.some((row) => row.id === contract.id));
      assert.ok(
        (await account.negotiations.listNegotiations({})).list.some((row) => row.id === negotiation.id),
      );
      await db.invoiceRequest.create({
        data: {
          requestNo: key(),
          contractId: contract.id,
          customerId: customer.id,
          amount: '10.00',
          createdBy: account.user.id,
        },
      });
    }
    for (const source of Object.keys(tables)) {
      assert.equal((await manager.collab.query(tables[source], {})).total, 3, source);
      assert.equal((await reader.collab.query(tables[source], {})).total, 3, source);
      assert.equal((await outsider.collab.query(tables[source], {})).total, 0, source);
    }
    await assert.rejects(lawyer.customers.getCustomer(customerIds[0]));
    await assert.rejects(
      manager.cases.createCase({
        title: '禁止跨分所',
        customerId: customerIds[3],
        lawyerId: manager.employee.id,
        caseType: '民事',
        branchId: org,
      }),
      code('CASE_CUSTOMER_UNAVAILABLE'),
    );
    await assert.rejects(
      reader.cases.createCase({
        title: '只读禁止创建',
        customerId: customerIds[0],
        lawyerId: reader.employee.id,
        caseType: '民事',
        branchId: org,
      }),
    );
    for (const source of ['CASES', 'CUSTOMERS', 'NEGOTIATIONS']) {
      const t = tables[source],
        detail = await manager.collab.describe(t);
      const field = detail.fields.find(
        (f) =>
          (f.options as { businessKey: string }).businessKey ===
          (source === 'CASES' ? 'title' : source === 'CUSTOMERS' ? 'name' : 'quotedAmount'),
      )!;
      const row = (await manager.collab.query(t, {})).records.find((r) => r.createdBy === admin.user.id)!;
      const input = {
        values: { [field.id]: source === 'NEGOTIATIONS' ? '300.00' : '授权编辑' },
        version: row.version,
        schemaVersion: detail.table.schemaVersion,
      };
      await assert.rejects(reader.collab.saveRecord(t, row.id, input, key()), code('COLLAB_FORBIDDEN'));
      await manager.collab.saveRecord(t, row.id, input, key());
      await assert.rejects(
        manager.collab.saveRecord(t, row.id, input, key()),
        code('COLLAB_RECORD_CONFLICT'),
      );
    }
    await assert.rejects(
      manager.collab.mutateTable(tables.CASES, { remove: true, version: 1 }, key()),
      code('COLLAB_FORBIDDEN'),
    );
    await admin.collab.mutateTable(tables.CONTRACTS, { remove: true, version: 1 }, key());
    assert.equal(await db.contract.count(), 4);
    await db.userRole.updateMany({
      where: { userId: reader.user.id },
      data: {
        revokedAt: new Date(),
        revokedByUserId: admin.user.id,
        revokeReason: '验收测试撤销角色授权并验证立即生效',
      },
    });
    const revoked = new CollaborationService(
      db,
      await new AuthorizationContextLoader(db).load(reader.user.id),
    );
    await assert.rejects(revoked.describe(tables.CASES), code('COLLAB_FORBIDDEN'));
  });
