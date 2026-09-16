import { buildOrganizationScopeWhere } from '../authorization/resource-scope-resolvers';
import { buildCaseScopeWhere, requireCaseAccess, withAuthorizedCaseFiles } from './case-scope';
// SPEC-033 Task 2: case-service —— 案件生命周期（create/update/list/get/close）。
// 形态镜像 finance/cost-service：3 参构造 (prisma, actor, authorizationContext)；
// requireAction 每公开方法第一行；assertExactKeys 入参白名单；同事务 OperationLog 审计。
// U5-B: every case action is constrained by its recorded creator/organization/team scope.

import {
  normalizeIntake,
  prepareAttachments,
  persistAttachments,
  cleanAttachments,
  removeStoredAttachments,
} from './case-intake';
import { buildContractScopeWhere, buildCustomerVisibilityWhere } from '../contract/contract-scope';
import { Prisma, PrismaClient } from '@prisma/client';

import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { AuditActor } from '../master-data/master-data-types';
import { makeBusinessNo } from '../crm/business-no';
import { CASE_ERROR_CODES, CaseError } from '../../domain/case/case-errors';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeOptionalText,
  normalizeRequiredText,
} from '../../domain/master-data/master-data-validation';
import {
  CASE_PRIORITIES,
  CASE_STATUSES,
  CaseListQuery,
  CaseView,
  CloseCaseInput,
  CreateCaseInput,
  PagedResult,
  UpdateCaseInput,
  projectCase,
} from './case-types';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export class CaseService {
  private readonly authorization: AuthorizationService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
  }

  async identityGaps(input: { page?: number }) {
    this.authorization.requireAction(this.authorizationContext, 'case.read');
    assertExactKeys(input, ['page']);
    const page = input.page ?? 1;
    if (!Number.isInteger(page) || page < 1) throw new MasterDataError('VALIDATION_FAILED', 400);
    const where: Prisma.CaseWhereInput = {
      AND: [
        await buildCaseScopeWhere(this.prisma, this.authorizationContext, 'case.read'),
        { OR: [{ createdBy: null }, { branchId: null }] },
      ],
    };
    const canRepair =
      ['case.update', 'user.read', 'organization.read'].every((code) =>
        (this.authorizationContext.permissionCodes as string[]).includes(code),
      ) &&
      (await this.authorization.resolveScopeTargets(this.authorizationContext, 'case', 'case.update')).all;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.case.count({ where }),
      this.prisma.case.findMany({
        where,
        select: { id: true, caseNo: true, title: true, createdBy: true, branchId: true, version: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * 20,
        take: 20,
      }),
    ]);
    const organizations = canRepair
      ? await this.prisma.organization.findMany({
          where: {
            AND: [
              { status: 'ENABLED' },
              buildOrganizationScopeWhere(
                await this.authorization.resolveScopeTargets(
                  this.authorizationContext,
                  'organization',
                  'organization.read',
                ),
              ),
            ],
          },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
          take: 500,
        })
      : [];
    const users = canRepair
      ? await this.prisma.user.findMany({
          where: {
            AND: [
              { status: 'ENABLED' },
              await this.authorization.buildScopeWhere(this.authorizationContext, 'user', 'user.read'),
            ],
          },
          select: { id: true, username: true },
          orderBy: { username: 'asc' },
          take: 500,
        })
      : [];
    return {
      rows,
      total,
      page,
      pageSize: 20,
      canRepair,
      organizations,
      users: users.map((user) => ({ id: user.id, name: user.username })),
    };
  }

  async repairIdentity(
    caseId: string,
    input: { createdBy?: string; branchId?: string; reason: string; version: number },
  ) {
    this.authorization.requireAction(this.authorizationContext, 'case.update');
    this.authorization.requireAction(this.authorizationContext, 'user.read');
    this.authorization.requireAction(this.authorizationContext, 'organization.read');
    const targets = await this.authorization.resolveScopeTargets(
      this.authorizationContext,
      'case',
      'case.update',
    );
    if (!targets.all) throw new MasterDataError('PERMISSION_DENIED', 403);
    assertExactKeys(input, ['createdBy', 'branchId', 'reason', 'version']);
    const id = normalizeRequiredText(caseId, 1, 100),
      reason = normalizeRequiredText(input.reason, 1, 1000),
      version = normalizeVersion(input.version);
    const createdBy =
      input.createdBy === undefined ? undefined : normalizeRequiredText(input.createdBy, 1, 100);
    const branchId = input.branchId === undefined ? undefined : normalizeRequiredText(input.branchId, 1, 100);
    if (!createdBy && !branchId) throw new MasterDataError('VALIDATION_FAILED', 400);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "case" WHERE id = ${id} FOR UPDATE`;
      const row = await requireCaseAccess(this.prisma, this.authorizationContext, id, 'case.update', tx);
      if (row.version !== version) throw new MasterDataError('VERSION_CONFLICT', 409);
      if ((createdBy && row.createdBy) || (branchId && row.branchId))
        throw new MasterDataError('VALIDATION_FAILED', 400);
      if (
        createdBy &&
        !(await tx.user.findFirst({
          where: {
            AND: [
              { id: createdBy, status: 'ENABLED' },
              await this.authorization.buildScopeWhere(this.authorizationContext, 'user', 'user.read'),
            ],
          },
        }))
      )
        throw new MasterDataError('VALIDATION_FAILED', 400);
      if (
        branchId &&
        !(await tx.organization.findFirst({
          where: {
            AND: [
              { id: branchId, status: 'ENABLED' },
              buildOrganizationScopeWhere(
                await this.authorization.resolveScopeTargets(
                  this.authorizationContext,
                  'organization',
                  'organization.read',
                ),
              ),
            ],
          },
        }))
      )
        throw new MasterDataError('VALIDATION_FAILED', 400);
      const updated = await tx.case.update({
        where: { id },
        data: { createdBy, branchId, version: { increment: 1 }, updatedBy: this.actor.actorUserId },
      });
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'CASE_IDENTITY_REPAIR',
          targetType: 'CASE',
          targetId: id,
          oldValues: JSON.stringify({ createdBy: row.createdBy, branchId: row.branchId }),
          newValues: JSON.stringify({ createdBy: updated.createdBy, branchId: updated.branchId, reason }),
          ip: this.actor.ip,
        },
      });
      return { id, version: updated.version };
    });
  }

  async bindFinanceContract(caseId: string, input: { contractId: string; version: number }) {
    this.authorization.requireAction(this.authorizationContext, 'case.update');
    this.authorization.requireAction(this.authorizationContext, 'contract.read');
    assertExactKeys(input, ['contractId', 'version']);
    const contractId = normalizeRequiredText(input.contractId, 1, 100),
      version = normalizeVersion(input.version);
    const scope = await buildContractScopeWhere(
      this.prisma,
      this.authorization,
      this.authorizationContext,
      'contract.read',
    );
    return this.prisma.$transaction(async (tx) => {
      // Contract first: same lock order as receivable commands that create cases.
      await tx.$queryRaw`SELECT id FROM contract WHERE id = ${contractId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "case" WHERE id = ${caseId} FOR UPDATE`;
      const row = await requireCaseAccess(this.prisma, this.authorizationContext, caseId, 'case.update', tx);
      const contract = await tx.contract.findFirst({
        where: { AND: [scope, { id: contractId, deletedAt: null }] },
      });
      if (!row || !contract || row.customerId !== contract.customerId)
        throw new MasterDataError('VALIDATION_FAILED', 400);
      if (row.version !== version) throw new MasterDataError('VERSION_CONFLICT', 409);
      if (row.contractId && row.contractId !== contractId)
        throw new MasterDataError('MASTER_DATA_IN_USE', 409);
      if (await tx.case.findFirst({ where: { contractId, id: { not: caseId } } }))
        throw new MasterDataError('MASTER_DATA_IN_USE', 409);
      const updated = await tx.case.update({
        where: { id: caseId },
        data: { contractId, updatedBy: this.actor.actorUserId, version: { increment: 1 } },
      });
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'CASE_BIND_FINANCE',
          targetType: 'CASE',
          targetId: caseId,
          newValues: JSON.stringify({ contractId }),
          ip: this.actor.ip,
        },
      });
      return projectCase(updated);
    });
  }

  /** 新建案件：case.create → 校验（title/caseType 必填、customerId/lawyerId 存在）→ caseNo=CA 随机码 → status PENDING + 审计。 */
  async createCase(input: CreateCaseInput): Promise<CaseView> {
    this.authorization.requireAction(this.authorizationContext, 'case.create');
    assertExactKeys(input, [
      'branchId',
      'intakeData',
      'attachments',
      'title',
      'customerId',
      'contractId',
      'lawyerId',
      'teamIds',
      'caseType',
      'priority',
      'fee',
      'description',
    ]);
    const title = normalizeRequiredText(input.title, 1, 100);
    const customerId = normalizeRequiredText(input.customerId, 1, 100);
    const caseType = normalizeRequiredText(input.caseType, 1, 100);
    const priority =
      input.priority === undefined ? 'NORMAL' : normalizeAllowedValue(input.priority, CASE_PRIORITIES);
    const description = normalizeOptionalText(input.description, 1000);
    const contractId = normalizeOptionalText(input.contractId, 100);
    const lawyerId = normalizeRequiredText(input.lawyerId, 1, 100);
    const intakeData = normalizeIntake(input.intakeData);
    const branchId = normalizeOptionalText(input.branchId, 100) || intakeData.departmentId || null;
    if (
      branchId &&
      !(await this.prisma.organization.findFirst({ where: { id: branchId, status: 'ENABLED' } }))
    )
      throw new MasterDataError('VALIDATION_FAILED', 400);
    if (
      intakeData.departmentId &&
      !(await this.prisma.organization.findFirst({
        where: { id: intakeData.departmentId, type: 'DEPARTMENT', status: 'ENABLED' },
      }))
    )
      throw new MasterDataError('VALIDATION_FAILED', 400);
    const attachments = prepareAttachments(input.attachments);
    if (attachments.length) this.authorization.requireAction(this.authorizationContext, 'case.file.manage');
    const teamIds =
      input.teamIds === undefined ? null : JSON.stringify(normalizeStringArray(input.teamIds, 50, 100));
    const fee = input.fee === undefined ? null : normalizeCaseFee(input.fee);

    this.authorization.requireAction(this.authorizationContext, 'customer.read');
    const customerScope = await buildCustomerVisibilityWhere(
      this.prisma,
      this.authorization,
      this.authorizationContext,
      'customer.read',
    );
    const customer = await this.prisma.customer.findFirst({
      where: { AND: [customerScope, { id: customerId, deletedAt: null }] },
    });
    if (!customer) throw new MasterDataError('VALIDATION_FAILED', 400);
    if (contractId !== null) {
      this.authorization.requireAction(this.authorizationContext, 'contract.read');
      const contractScope = await buildContractScopeWhere(
        this.prisma,
        this.authorization,
        this.authorizationContext,
        'contract.read',
      );
      const contract = await this.prisma.contract.findFirst({
        where: { AND: [contractScope, { id: contractId, deletedAt: null }] },
      });
      if (!contract || contract.customerId !== customerId)
        throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    if (lawyerId !== null) {
      const lawyer = await this.prisma.employee.findFirst({ where: { id: lawyerId } });
      if (!lawyer) throw new MasterDataError('VALIDATION_FAILED', 400);
    }

    const caseNo = makeBusinessNo('CA');
    try {
      persistAttachments(attachments);
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.case.create({
          data: {
            caseNo,
            createdBy: this.actor.actorUserId,
            branchId,
            updatedBy: this.actor.actorUserId,
            intakeData,
            files: {
              create: attachments.map((file) => ({
                fileName: file.fileName,
                fileType: file.fileType,
                category: file.category,
                filePath: file.filePath,
                fileSize: file.buffer.length,
                uploadedBy: this.actor.actorUserId,
              })),
            },
            title,
            customerId,
            contractId,
            lawyerId,
            teamIds,
            caseType,
            status: 'PENDING',
            priority,
            description,
            fee: fee ?? undefined,
          },
        });
        await tx.operationLog.create({
          data: {
            userId: this.actor.actorUserId,
            action: 'CASE_CREATE',
            targetType: 'CASE',
            targetId: created.id,
            newValues: JSON.stringify({ caseId: created.id, caseNo, title, caseType, customerId }),
            ip: this.actor.ip,
          },
        });
        await requireCaseAccess(this.prisma, this.authorizationContext, created.id, 'case.create', tx);
        if (attachments.length)
          await requireCaseAccess(this.prisma, this.authorizationContext, created.id, 'case.file.manage', tx);
        return projectCase(created);
      });
    } catch (error) {
      cleanAttachments(attachments);
      throw error;
    }
  }

  /** 更新案件：case.update → 白名单 + 乐观锁（updateMany {id, version} → VERSION_CONFLICT 409）+ 审计。 */
  async updateCase(caseId: string, input: UpdateCaseInput): Promise<CaseView> {
    this.authorization.requireAction(this.authorizationContext, 'case.update');
    const id = normalizeRequiredText(caseId, 1, 100);
    assertExactKeys(input, [
      'customerId',
      'fee',
      'intakeData',
      'attachments',
      'removeAttachmentIds',
      'title',
      'lawyerId',
      'teamIds',
      'caseType',
      'priority',
      'description',
      'result',
      'satisfaction',
      'isReferrable',
      'version',
    ]);
    const customerId =
      input.customerId === undefined ? undefined : normalizeRequiredText(input.customerId, 1, 100);
    const fee = input.fee === undefined ? undefined : normalizeCaseFee(input.fee);
    const intakeData = input.intakeData === undefined ? undefined : normalizeIntake(input.intakeData);
    if (
      intakeData?.departmentId &&
      !(await this.prisma.organization.findFirst({
        where: { id: intakeData.departmentId, type: 'DEPARTMENT', status: 'ENABLED' },
      }))
    )
      throw new MasterDataError('VALIDATION_FAILED', 400);
    const attachments = prepareAttachments(input.attachments);
    const removeIds =
      input.removeAttachmentIds === undefined
        ? []
        : (normalizeStringArray(input.removeAttachmentIds, 100, 100) ?? []);
    if (attachments.length || removeIds.length)
      this.authorization.requireAction(this.authorizationContext, 'case.file.manage');
    const title = input.title === undefined ? undefined : normalizeRequiredText(input.title, 1, 100);
    const caseType = input.caseType === undefined ? undefined : normalizeRequiredText(input.caseType, 1, 100);
    const priority =
      input.priority === undefined ? undefined : normalizeAllowedValue(input.priority, CASE_PRIORITIES);
    const description =
      input.description === undefined ? undefined : normalizeOptionalText(input.description, 1000);
    const result = input.result === undefined ? undefined : normalizeOptionalText(input.result, 1000);
    const satisfaction =
      input.satisfaction === undefined ? undefined : normalizeSatisfaction(input.satisfaction);
    const isReferrable = input.isReferrable;
    const lawyerId = input.lawyerId === undefined ? undefined : normalizeRequiredText(input.lawyerId, 1, 100);
    const teamIds =
      input.teamIds === undefined ? undefined : JSON.stringify(normalizeStringArray(input.teamIds, 50, 100));
    const version = normalizeVersion(input.version);

    // SPEC-035：Case 乐观锁——先读现状（存在/终态判），再 updateMany {id, version} 守卫并发编辑。
    const existing = await requireCaseAccess(this.prisma, this.authorizationContext, id, 'case.update');
    if (!existing) throw new CaseError(CASE_ERROR_CODES.CASE_NOT_FOUND, 404, 'case not found');
    if (existing.status === 'CLOSED' || existing.status === 'ARCHIVED') {
      throw new CaseError(CASE_ERROR_CODES.CASE_STATE_INVALID, 409, 'case is already closed');
    }
    if (lawyerId !== undefined && lawyerId !== null) {
      const lawyer = await this.prisma.employee.findFirst({ where: { id: lawyerId } });
      if (!lawyer) throw new MasterDataError('VALIDATION_FAILED', 400);
    }

    const data: Prisma.CaseUncheckedUpdateManyInput = {};
    if (customerId !== undefined) data.customerId = customerId;
    if (fee !== undefined) data.fee = fee;
    if (intakeData !== undefined) data.intakeData = intakeData;
    if (title !== undefined) data.title = title;
    if (caseType !== undefined) data.caseType = caseType;
    if (priority !== undefined) data.priority = priority;
    if (description !== undefined) data.description = description;
    if (result !== undefined) data.result = result;
    if (satisfaction !== undefined) data.satisfaction = satisfaction;
    if (isReferrable !== undefined) data.isReferrable = isReferrable;
    if (lawyerId !== undefined) data.lawyerId = lawyerId;
    if (teamIds !== undefined) data.teamIds = teamIds;
    data.version = version + 1;
    data.updatedBy = this.actor.actorUserId;

    let removedFiles: { filePath: string }[] = [];
    let updated: CaseView;
    try {
      persistAttachments(attachments);
      updated = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "case" WHERE id = ${id} FOR UPDATE`;
        await requireCaseAccess(this.prisma, this.authorizationContext, id, 'case.update', tx);
        if (attachments.length || removeIds.length)
          await requireCaseAccess(this.prisma, this.authorizationContext, id, 'case.file.manage', tx);
        const currentCase = await tx.case.findUnique({ where: { id }, include: { contract: true } });
        if (customerId !== undefined) {
          this.authorization.requireAction(this.authorizationContext, 'customer.read');
          const customerScope = await buildCustomerVisibilityWhere(
            this.prisma,
            this.authorization,
            this.authorizationContext,
            'customer.read',
          );
          if (
            !(await tx.customer.findFirst({
              where: { AND: [customerScope, { id: customerId, deletedAt: null }] },
            }))
          )
            throw new MasterDataError('VALIDATION_FAILED', 400);
          if (currentCase?.contract && currentCase.contract.customerId !== customerId)
            throw new MasterDataError('VALIDATION_FAILED', 400);
        }
        const flipped = await tx.case.updateMany({
          where: { id, version, status: { notIn: ['CLOSED', 'ARCHIVED'] } },
          data,
        });
        if (flipped.count === 0) {
          const current = await tx.case.findUnique({ where: { id } });
          if (!current) throw new CaseError(CASE_ERROR_CODES.CASE_NOT_FOUND, 404, 'case not found');
          if (current.status === 'CLOSED' || current.status === 'ARCHIVED') {
            throw new CaseError(CASE_ERROR_CODES.CASE_STATE_INVALID, 409, 'case is already closed');
          }
          throw new CaseError(CASE_ERROR_CODES.CASE_VERSION_CONFLICT, 409, 'case version conflict');
        }
        removedFiles = await tx.caseFile.findMany({
          where: { caseId: id, id: { in: removeIds } },
          select: { filePath: true },
        });
        if (removedFiles.length !== removeIds.length) throw new MasterDataError('VALIDATION_FAILED', 400);
        if (removeIds.length) await tx.caseFile.deleteMany({ where: { caseId: id, id: { in: removeIds } } });
        if (attachments.length)
          await tx.caseFile.createMany({
            data: attachments.map((file) => ({
              caseId: id,
              fileName: file.fileName,
              fileType: file.fileType,
              category: file.category,
              filePath: file.filePath,
              fileSize: file.buffer.length,
              uploadedBy: this.actor.actorUserId,
            })),
          });
        const row = await tx.case.findUniqueOrThrow({ where: { id } });
        await tx.operationLog.create({
          data: {
            userId: this.actor.actorUserId,
            action: 'CASE_UPDATE',
            targetType: 'CASE',
            targetId: row.id,
            newValues: JSON.stringify({ caseId: row.id, caseNo: row.caseNo, version: row.version }),
            ip: this.actor.ip,
          },
        });
        return projectCase(row);
      });
    } catch (error) {
      cleanAttachments(attachments);
      throw error;
    }
    removeStoredAttachments(removedFiles);
    return updated;
  }

  async deleteCase(caseId: string, input: { version: number }): Promise<{ id: string }> {
    this.authorization.requireAction(this.authorizationContext, 'case.delete');
    const id = normalizeRequiredText(caseId, 1, 100);
    assertExactKeys(input, ['version']);
    const version = normalizeVersion(input.version);
    const files = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "case" WHERE id = ${id} FOR UPDATE`;
      await requireCaseAccess(this.prisma, this.authorizationContext, id, 'case.delete', tx);
      const row = await tx.case.findUnique({
        where: { id },
        include: {
          files: true,
          _count: { select: { costEntries: true, tasks: true, communications: true, sopInstances: true } },
        },
      });
      if (!row) throw new CaseError(CASE_ERROR_CODES.CASE_NOT_FOUND, 404, 'case not found');
      if (row.version !== version) throw new MasterDataError('VERSION_CONFLICT', 409);
      if (['CLOSED', 'ARCHIVED'].includes(row.status))
        throw new CaseError(CASE_ERROR_CODES.CASE_STATE_INVALID, 409, 'case is already closed');
      if (row.contractId || row._count.costEntries || row._count.sopInstances)
        throw new CaseError(CASE_ERROR_CODES.CASE_IN_USE, 409, 'case has financial references');
      await tx.case.delete({ where: { id } });
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'CASE_DELETE',
          targetType: 'CASE',
          targetId: id,
          oldValues: JSON.stringify({
            caseId: id,
            caseNo: row.caseNo,
            title: row.title,
            version: row.version,
            tasks: row._count.tasks,
            communications: row._count.communications,
            files: row.files.length,
          }),
          ip: this.actor.ip,
        },
      });
      return row.files;
    });
    removeStoredAttachments(files);
    return { id };
  }

  /** 案件列表：case.read → 过滤（keyword/status/lawyerId/priority/customerId）+ 分页 createdAt DESC。 */
  async listCases(query: CaseListQuery): Promise<PagedResult<CaseView>> {
    this.authorization.requireAction(this.authorizationContext, 'case.read');
    // assertExactKeys 收窄入参为 Record<string, unknown>——先捕获分页字段保类型。
    const rawPage = query.page;
    const rawPageSize = query.pageSize;
    assertExactKeys(query, [
      'page',
      'pageSize',
      'keyword',
      'status',
      'lawyerId',
      'priority',
      'customerId',
      'caseNo',
      'branchId',
    ]);
    const page = rawPage === undefined ? 1 : rawPage;
    const pageSize = rawPageSize === undefined ? DEFAULT_PAGE_SIZE : rawPageSize;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > MAX_PAGE_SIZE
    ) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }

    const where: Prisma.CaseWhereInput = {
      AND: [await buildCaseScopeWhere(this.prisma, this.authorizationContext, 'case.read')],
    };
    if (query.branchId !== undefined) where.branchId = normalizeRequiredText(query.branchId, 1, 100);
    const keyword = normalizeOptionalText(query.keyword, 100);
    if (keyword)
      where.OR = [
        { title: { contains: keyword } },
        { caseNo: { contains: keyword } },
        { caseType: { contains: keyword } },
        { customer: { name: { contains: keyword } } },
        ...['contractNumber', 'region', 'caseCategory'].map((key) => ({
          intakeData: { path: [key], string_contains: keyword },
        })),
      ];
    if (query.caseNo !== undefined) where.caseNo = normalizeRequiredText(query.caseNo, 1, 100);
    if (query.status !== undefined) where.status = normalizeAllowedValue(query.status, CASE_STATUSES);
    if (query.lawyerId !== undefined) where.lawyerId = normalizeRequiredText(query.lawyerId, 1, 100);
    if (query.priority !== undefined) where.priority = normalizeAllowedValue(query.priority, CASE_PRIORITIES);
    if (query.customerId !== undefined) where.customerId = normalizeRequiredText(query.customerId, 1, 100);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.case.count({ where }),
      this.prisma.case.findMany({
        where,
        include: { customer: { select: { name: true } }, lawyer: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      list: await withAuthorizedCaseFiles(
        this.prisma,
        this.authorizationContext,
        rows.map((row) => projectCase(row)),
      ),
      page,
      pageSize,
      total,
    };
  }

  /** 案件详情：case.read → 含 tasks + communications + customer/lawyer 投影。 */
  async getCase(caseId: string): Promise<CaseView> {
    this.authorization.requireAction(this.authorizationContext, 'case.read');
    const id = normalizeRequiredText(caseId, 1, 100);
    const row = await this.prisma.case.findFirst({
      where: {
        AND: [{ id }, await buildCaseScopeWhere(this.prisma, this.authorizationContext, 'case.read')],
      },
      include: {
        customer: { select: { name: true } },
        lawyer: { select: { name: true } },
        tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        communications: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] },
      },
    });
    if (!row) throw new CaseError(CASE_ERROR_CODES.CASE_NOT_FOUND, 404, 'case not found');
    return (await withAuthorizedCaseFiles(this.prisma, this.authorizationContext, [projectCase(row)]))[0];
  }

  /** Controlled acceptance, processing and archive; closing retains its dedicated result form. */
  async transitionCase(caseId: string, input: { status: string; version: number }): Promise<CaseView> {
    assertExactKeys(input, ['status', 'version']);
    const id = normalizeRequiredText(caseId, 1, 100);
    const status = normalizeAllowedValue(input.status, ['ACCEPTED', 'PROCESSING', 'ARCHIVED']);
    const version = normalizeVersion(input.version);
    const permission = status === 'ARCHIVED' ? 'case.close' : 'case.update';
    this.authorization.requireAction(this.authorizationContext, permission);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "case" WHERE id = ${id} FOR UPDATE`;
      const current = await requireCaseAccess(this.prisma, this.authorizationContext, id, permission, tx);
      if (current.version !== version) throw new MasterDataError('VERSION_CONFLICT', 409);
      const previous = { ACCEPTED: 'PENDING', PROCESSING: 'ACCEPTED', ARCHIVED: 'CLOSED' }[status];
      if (current.status !== previous)
        throw new CaseError(CASE_ERROR_CODES.CASE_STATE_INVALID, 409, 'invalid case transition');
      const updated = await tx.case.update({
        where: { id },
        data: { status, version: { increment: 1 }, updatedBy: this.actor.actorUserId },
      });
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'CASE_STATUS',
          targetType: 'CASE',
          targetId: id,
          oldValues: JSON.stringify({ status: current.status, version: current.version }),
          newValues: JSON.stringify({ status, version: updated.version }),
          ip: this.actor.ip,
        },
      });
      return projectCase(updated);
    });
  }

  /** 结案：case.close → 状态非终态 → CLOSED + closedAt + result/satisfaction + 审计。 */
  async closeCase(caseId: string, input: CloseCaseInput): Promise<CaseView> {
    this.authorization.requireAction(this.authorizationContext, 'case.close');
    const id = normalizeRequiredText(caseId, 1, 100);
    assertExactKeys(input, ['result', 'satisfaction']);
    const result = normalizeOptionalText(input.result, 1000);
    const satisfaction =
      input.satisfaction === undefined ? undefined : normalizeSatisfaction(input.satisfaction);

    // 状态守卫（Case 无 version 列）：updateMany {id, status notIn 终态} → count=0 → 已结案/不存在 409。
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "case" WHERE id = ${id} FOR UPDATE`;
      await requireCaseAccess(this.prisma, this.authorizationContext, id, 'case.close', tx);
      const flipped = await tx.case.updateMany({
        where: { id, status: { notIn: ['CLOSED', 'ARCHIVED'] } },
        data: {
          status: 'CLOSED',
          version: { increment: 1 },
          updatedBy: this.actor.actorUserId,
          closedAt: new Date(),
          result: result ?? undefined,
          satisfaction: satisfaction ?? undefined,
        },
      });
      if (flipped.count === 0) {
        const existing = await tx.case.findUnique({ where: { id } });
        if (!existing) throw new CaseError(CASE_ERROR_CODES.CASE_NOT_FOUND, 404, 'case not found');
        throw new CaseError(CASE_ERROR_CODES.CASE_STATE_INVALID, 409, 'case is already closed');
      }
      const row = await tx.case.findUniqueOrThrow({ where: { id } });
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'CASE_CLOSE',
          targetType: 'CASE',
          targetId: row.id,
          newValues: JSON.stringify({ caseId: row.id, caseNo: row.caseNo, result: result ?? null }),
          ip: this.actor.ip,
        },
      });
      return projectCase(row);
    });
  }
}

/** 案件费用规范化：非负数字字符串（≤ Decimal(18,2)），非法 → 400。 */
function normalizeCaseFee(value: string): string {
  if (typeof value !== 'string' || !/^\d{1,16}(\.\d{1,2})?$/.test(value)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return value;
}

/** teamIds 规范化：非空数组 ≤50，每项 1-100 去重。 */
function normalizeStringArray(value: unknown, maxItems: number, maxItemLength: number): string[] | null {
  if (!Array.isArray(value)) throw new MasterDataError('VALIDATION_FAILED', 400);
  if (value.length > maxItems) throw new MasterDataError('VALIDATION_FAILED', 400);
  const normalized = value.map((item) => normalizeRequiredText(item, 1, maxItemLength));
  return [...new Set(normalized)];
}

/** 满意度校验：整数 1-5。 */
function normalizeSatisfaction(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return value;
}

/** 乐观锁 version 校验：正整数（≥1），非法 → 400。 */
function normalizeVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return value;
}
