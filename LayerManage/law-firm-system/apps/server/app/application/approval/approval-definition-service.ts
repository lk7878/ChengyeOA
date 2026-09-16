import { randomUUID } from 'node:crypto';
// SPEC-013 Task 5: approval-definition-service —— 审批定义查询（ACTIVE 表单渲染用）。
// SPEC-017 Task 1: +4 定义管理方法（createDefinition/updateDefinition/setDefinitionStatus/
// listAllDefinitions，均 requireAction approval.manage 第一行）+ nodeSchema/formSchema/
// approverRule 校验（nodeSchema 沿 SPEC-016 buildApprovalChain 语义本地镜像——buildApprovalChain
// 是 approval-instance-service 的私有函数，避免跨服务 import 沿项目惯例内联同语义校验）。
// 3 参构造 (prisma, actor, authorizationContext) 镜像 invoice-service 形态；requireAction
// 每公开方法第一行。getActiveDefinition 供 applyForApproval 消费（approval.apply 动作码）；
// listDefinitions 供前端发起审批页表单渲染（同挂 approval.apply——定义即"可申请的菜单"，
// 无 definition.read 码，Task 2 三码仅 read/apply/process）。审批无组织锚：本服务不建范围。
// SPEC-025 Task 1: +exportDefinitions/importDefinitions（approval.manage）——全量导出（含
// DISABLED，code 升序）+ 批量导入（单事务逐定义 upsert 按 code，复用 create/update 校验 +
// version 前置条件，上限 100，幂等，审计 APPROVAL_DEFINITION_IMPORT）。

import { Prisma, PrismaClient } from '@prisma/client';

import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { AuditActor } from '../master-data/master-data-types';
import { APPROVAL_ERROR_CODES, ApprovalError } from '../../domain/approval/approval-errors';
import {
  APPROVAL_BUSINESS_TYPES,
  type ApprovalBusinessType,
} from '../../domain/approval/approval-types';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeRequiredText,
  normalizeVersion,
} from '../../domain/master-data/master-data-validation';
import {
  ApprovalDefinitionView,
  DEFINITION_EXPORT_SCHEMA_VERSION,
  DefinitionExportPayload,
  ExportDefinitionsQuery,
  ImportDefinitionsInput,
  ImportResult,
  projectApprovalDefinition,
  UpdateDefinitionWithStatusInput,
} from './approval-types';

const APPROVAL_DEFINITION_STATUSES = ['ACTIVE', 'DISABLED'] as const;

const FORM_FIELD_TYPES = ['date', 'text', 'textarea', 'number'] as const;

/** SPEC-017 Task 2 M1：create 定义 code 收紧——大写字母开头，仅 A-Z/0-9/_，总长 1-100。 */
const APPROVAL_DEFINITION_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,99}$/;

export interface CreateDefinitionInput {
  /** 唯一，1-100（沿种子命名 EXPENSE_xxx 惯例；create 后不可改）。 */
  code: string;
  name: string;
  businessType: ApprovalBusinessType;
  formSchema: Prisma.InputJsonValue;
  approverRule: Prisma.InputJsonValue;
  /** 可选多级节点链；缺省/null = 顶层 approverRule 单节点。 */
  nodeSchema?: Prisma.InputJsonValue | null;
}

export interface UpdateDefinitionInput {
  name?: string;
  formSchema?: Prisma.InputJsonValue;
  approverRule?: Prisma.InputJsonValue;
  /** 显式 null = 回落单节点；undefined = 不改动。 */
  nodeSchema?: Prisma.InputJsonValue | null;
}

export class ApprovalDefinitionService {
  private readonly authorization: AuthorizationService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
  }

  /**
   * 单定义探查（applyForApproval 内部消费 + Task 6 详情路由）：approval.apply →
   * 规范化 code → findFirst {code, status:'ACTIVE'} → 缺/DISABLED 统一
   * APPROVAL_DEFINITION_NOT_FOUND 404 不泄露存在性。
   */
  async getActiveDefinition(code: string): Promise<ApprovalDefinitionView> {
    this.authorization.requireAction(this.authorizationContext, 'approval.apply');
    const definitionCode = normalizeRequiredText(code, 1, 100);
    const definition = await this.prisma.approvalDefinition.findFirst({
      where: { businessType: {notIn:['SOP_REVIEW','QUALITY_ANALYSIS']}, code: definitionCode, status: 'ACTIVE', OR: [{ ownerUserId: null }, { ownerUserId: this.actor.actorUserId }] },
    });
    if (!definition) {
      throw new ApprovalError(
        APPROVAL_ERROR_CODES.APPROVAL_DEFINITION_NOT_FOUND,
        404,
        'approval definition not found',
      );
    }
    return projectApprovalDefinition(definition);
  }

  /** ACTIVE 定义全量（前端表单渲染用）：approval.apply → 按 code 升序。 */
  async listDefinitions(): Promise<ApprovalDefinitionView[]> {
    this.authorization.requireAction(this.authorizationContext, 'approval.apply');
    const rows = await this.prisma.approvalDefinition.findMany({
      where: { businessType: {notIn:['SOP_REVIEW','QUALITY_ANALYSIS']}, status: 'ACTIVE', OR: [{ ownerUserId: null }, { ownerUserId: this.actor.actorUserId }] },
      orderBy: [{ code: 'asc' }],
    });
    return rows.map(projectApprovalDefinition);
  }

  /**
   * 新建定义：approval.manage → normalize 各字段 → code 唯一（命中 → APPROVAL_DEFINITION_CODE_CONFLICT
   * 400）→ nodeSchema/formSchema/approverRule 三校验 → create（version 默认 1、status ACTIVE、
   * createdBy=actor）→ 视图 + 审计（APPROVAL_DEFINITION_CREATE）。
   */
  async createDefinition(input: CreateDefinitionInput): Promise<ApprovalDefinitionView> {
    this.authorization.requireAction(this.authorizationContext, 'approval.manage');
    return this.createValidatedDefinition(input, null);
  }

  async createPersonalDefinition(input: { name: string; templateCode: string }): Promise<ApprovalDefinitionView> {
    this.authorization.requireAction(this.authorizationContext, 'approval.apply');
    assertExactKeys(input, ['name', 'templateCode']);
    const template = await this.getActiveDefinition(input.templateCode);
    return this.createValidatedDefinition({ code: 'CUSTOM_' + randomUUID().replaceAll('-', '').toUpperCase(), name: input.name, businessType: 'CUSTOM', formSchema: template.formSchema as Prisma.InputJsonValue, approverRule: template.approverRule as Prisma.InputJsonValue, nodeSchema: template.nodeSchema as Prisma.InputJsonValue }, this.actor.actorUserId);
  }

  private async createValidatedDefinition(input: CreateDefinitionInput, ownerUserId: string | null): Promise<ApprovalDefinitionView> {
    // 共用校验；个人类型只能从本人可用模板复制，不能指定审批规则。
    const formSchema = input.formSchema;
    const approverRule = input.approverRule;
    const nodeSchema = input.nodeSchema ?? null;
    assertExactKeys(input, ['code', 'name', 'businessType', 'formSchema', 'approverRule', 'nodeSchema']);
    const code = normalizeRequiredText(input.code, 1, 100);
    // SPEC-017 Task 2 M1：code 校验收紧——大写字母开头，仅 A-Z/0-9/_（沿种子命名惯例）。
    // 既有 getActiveDefinition/listDefinitions 不收紧（兼容既有种子/apply 路径零回归）。
    if (!APPROVAL_DEFINITION_CODE_PATTERN.test(code)) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    const name = normalizeRequiredText(input.name, 1, 100);
    const businessType = normalizeAllowedValue(input.businessType, APPROVAL_BUSINESS_TYPES);
    if (['SOP_REVIEW','QUALITY_ANALYSIS'].includes(businessType) || code.startsWith('SOP_') || code.startsWith('QUALITY_')) throw new MasterDataError('SOP_REVIEW_ADAPTER_REQUIRED',409);

    const existing = await this.prisma.approvalDefinition.findUnique({ where: { code } });
    if (existing) {
      throw new ApprovalError(
        APPROVAL_ERROR_CODES.APPROVAL_DEFINITION_CODE_CONFLICT,
        400,
        'approval definition code already exists',
      );
    }
    this.assertNodeSchemaValid(nodeSchema);
    this.assertFormSchemaValid(formSchema);
    this.assertApproverRuleValid(approverRule);

    return this.prisma.$transaction(async tx => {
      const definition = await tx.approvalDefinition.create({
        data: {
          code,
          ownerUserId,
          name,
          businessType,
          formSchema,
          approverRule,
          nodeSchema: nodeSchema === null ? Prisma.DbNull : nodeSchema,
          status: 'ACTIVE',
          createdBy: this.actor.actorUserId,
        },
      });
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'APPROVAL_DEFINITION_CREATE',
          targetType: 'APPROVAL_DEFINITION',
          targetId: definition.id,
          newValues: JSON.stringify({
            definitionId: definition.id,
            code: definition.code,
            businessType: definition.businessType,
            version: definition.version,
            status: definition.status,
          }),
          ip: this.actor.ip,
        },
      });
      return projectApprovalDefinition(definition);
    });
  }

  /**
   * 更新定义：approval.manage → 404 → 白名单（name/formSchema/approverRule/nodeSchema；
   * code/businessType/status 不可改——assertExactKeys 拒绝白名单外键）→ 变更字段校验 →
   * version+1 → 视图 + 审计（APPROVAL_DEFINITION_UPDATE）。
   */
  async updateDefinition(code: string, input: UpdateDefinitionInput): Promise<ApprovalDefinitionView> {
    this.authorization.requireAction(this.authorizationContext, 'approval.manage');
    // assertExactKeys 会把入参收窄为 Record<string, unknown>，故先捕获各字段保类型。
    const nameInput = input.name;
    const formSchemaInput = input.formSchema;
    const approverRuleInput = input.approverRule;
    const nodeSchemaInput = input.nodeSchema;
    assertExactKeys(input, ['name', 'formSchema', 'approverRule', 'nodeSchema']);
    const definitionCode = normalizeRequiredText(code, 1, 100);
    const existing = await this.prisma.approvalDefinition.findUnique({ where: { code: definitionCode } });
    if (existing && ['SOP_REVIEW','QUALITY_ANALYSIS'].includes(existing.businessType)) throw new MasterDataError('SOP_REVIEW_ROUTING_FIXED',409);
    if (!existing) {
      throw new ApprovalError(
        APPROVAL_ERROR_CODES.APPROVAL_DEFINITION_NOT_FOUND,
        404,
        'approval definition not found',
      );
    }

    const data: Prisma.ApprovalDefinitionUpdateManyMutationInput = { version: { increment: 1 } };
    const changedFields: string[] = [];
    if (nameInput !== undefined) {
      data.name = normalizeRequiredText(nameInput, 1, 100);
      changedFields.push('name');
    }
    if (formSchemaInput !== undefined) {
      this.assertFormSchemaValid(formSchemaInput);
      data.formSchema = formSchemaInput;
      changedFields.push('formSchema');
    }
    if (approverRuleInput !== undefined) {
      this.assertApproverRuleValid(approverRuleInput);
      data.approverRule = approverRuleInput;
      changedFields.push('approverRule');
    }
    if (nodeSchemaInput !== undefined) {
      this.assertNodeSchemaValid(nodeSchemaInput);
      data.nodeSchema = nodeSchemaInput === null ? Prisma.DbNull : nodeSchemaInput;
      changedFields.push('nodeSchema');
    }

    // SPEC-024 乐观锁（沿 SPEC-019 forwardTask updateMany version 守卫先例）：事务内
    // updateMany({code, version: existing.version})——并发双写时后写 count=0 → 409 全或无；
    // 审计 fromVersion 用锁前读的 existing.version，count>0 → 事务内重读返回。
    const updated = await this.prisma.$transaction(async tx => {
      const flipped = await tx.approvalDefinition.updateMany({
        where: { code: definitionCode, version: existing.version },
        data,
      });
      if (flipped.count === 0) {
        throw new ApprovalError(
          APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID,
          409,
          'approval definition state changed concurrently',
        );
      }
      const row = await tx.approvalDefinition.findUniqueOrThrow({ where: { code: definitionCode } });
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'APPROVAL_DEFINITION_UPDATE',
          targetType: 'APPROVAL_DEFINITION',
          targetId: row.id,
          newValues: JSON.stringify({
            definitionId: row.id,
            code: row.code,
            businessType: row.businessType,
            fromVersion: existing.version,
            toVersion: row.version,
            changedFields,
          }),
          ip: this.actor.ip,
        },
      });
      return row;
    });
    return projectApprovalDefinition(updated);
  }

  /**
   * 启用/禁用（disable 与 enable 共用）：approval.manage → 404 → status ∈ {ACTIVE, DISABLED}
   * → update status + version+1 → 视图 + 审计（APPROVAL_DEFINITION_STATUS）。
   * DISABLED 定义经 getActiveDefinition 自动拒（404，apply 不可用）。
   */
  async setDefinitionStatus(code: string, status: 'ACTIVE' | 'DISABLED'): Promise<ApprovalDefinitionView> {
    this.authorization.requireAction(this.authorizationContext, 'approval.manage');
    const definitionCode = normalizeRequiredText(code, 1, 100);
    const nextStatus = normalizeAllowedValue(status, APPROVAL_DEFINITION_STATUSES);
    const existing = await this.prisma.approvalDefinition.findUnique({ where: { code: definitionCode } });
    if (existing && ['SOP_REVIEW','QUALITY_ANALYSIS'].includes(existing.businessType)) throw new MasterDataError('SOP_REVIEW_ROUTING_FIXED',409);
    if (!existing) {
      throw new ApprovalError(
        APPROVAL_ERROR_CODES.APPROVAL_DEFINITION_NOT_FOUND,
        404,
        'approval definition not found',
      );
    }

    // SPEC-024 乐观锁（沿 SPEC-019 forwardTask updateMany version 守卫先例）：事务内
    // updateMany({code, version: existing.version}, {status, version+1})——并发双写时后写
    // count=0 → 409 全或无；审计 fromStatus 用锁前读的 existing.status，count>0 → 事务内重读返回。
    const updated = await this.prisma.$transaction(async tx => {
      const flipped = await tx.approvalDefinition.updateMany({
        where: { code: definitionCode, version: existing.version },
        data: { status: nextStatus, version: { increment: 1 } },
      });
      if (flipped.count === 0) {
        throw new ApprovalError(
          APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID,
          409,
          'approval definition state changed concurrently',
        );
      }
      const row = await tx.approvalDefinition.findUniqueOrThrow({ where: { code: definitionCode } });
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'APPROVAL_DEFINITION_STATUS',
          targetType: 'APPROVAL_DEFINITION',
          targetId: row.id,
          newValues: JSON.stringify({
            definitionId: row.id,
            code: row.code,
            businessType: row.businessType,
            fromStatus: existing.status,
            toStatus: row.status,
            version: row.version,
          }),
          ip: this.actor.ip,
        },
      });
      return row;
    });
    return projectApprovalDefinition(updated);
  }

  /**
   * 同体更新定义 + 启用/禁用（SPEC-024 组合方法，controller PATCH 同体调用）：approval.manage
   * → 入参白名单（name/formSchema/approverRule/nodeSchema/status/version，update 字段或 status
   * 至少一项）→ 变更字段校验 + status 枚举 + version 前置条件校验 → 单事务：existing 读（事务内，
   * 404 统一）→ update 段（updateMany({code, version}, data) 乐观锁 count=0 → 409）→ 若 status
   * 存在 status 段（基于 update 后 version 乐观锁）→ 审计（两段合并单条）→ 返回视图。
   * version 语义：update+status 各 +1（同 PATCH 同体当前行为）；可选 version 前置条件（客户端
   * 持有版本）与当前不符 → 第一段 updateMany count=0 → 409（并发竞争，评审 M3 确定性构造）；
   * 缺省沿用锁前读 existing.version。任一段进程中断 → 单事务回滚全或无。
   */
  async updateDefinitionWithStatus(
    code: string,
    input: UpdateDefinitionWithStatusInput,
  ): Promise<ApprovalDefinitionView> {
    this.authorization.requireAction(this.authorizationContext, 'approval.manage');
    // assertExactKeys 会把入参收窄为 Record<string, unknown>，故先捕获各字段保类型。
    const nameInput = input.name;
    const formSchemaInput = input.formSchema;
    const approverRuleInput = input.approverRule;
    const nodeSchemaInput = input.nodeSchema;
    const statusInput = input.status;
    const versionInput = input.version;
    assertExactKeys(input, ['name', 'formSchema', 'approverRule', 'nodeSchema', 'status', 'version']);
    if (
      nameInput === undefined && formSchemaInput === undefined
      && approverRuleInput === undefined && nodeSchemaInput === undefined
      && statusInput === undefined
    ) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    // 可选乐观锁前置条件：提供则校验正整数，并用作第一段 updateMany 的 version 守卫。
    const versionPrecondition = versionInput === undefined ? undefined : normalizeVersion(versionInput);
    const definitionCode = normalizeRequiredText(code, 1, 100);

    const data: Prisma.ApprovalDefinitionUpdateManyMutationInput = { version: { increment: 1 } };
    const changedFields: string[] = [];
    if (nameInput !== undefined) {
      data.name = normalizeRequiredText(nameInput, 1, 100);
      changedFields.push('name');
    }
    if (formSchemaInput !== undefined) {
      this.assertFormSchemaValid(formSchemaInput);
      data.formSchema = formSchemaInput;
      changedFields.push('formSchema');
    }
    if (approverRuleInput !== undefined) {
      this.assertApproverRuleValid(approverRuleInput);
      data.approverRule = approverRuleInput;
      changedFields.push('approverRule');
    }
    if (nodeSchemaInput !== undefined) {
      this.assertNodeSchemaValid(nodeSchemaInput);
      data.nodeSchema = nodeSchemaInput === null ? Prisma.DbNull : nodeSchemaInput;
      changedFields.push('nodeSchema');
    }
    const hasUpdateFields = changedFields.length > 0;

    let nextStatus: 'ACTIVE' | 'DISABLED' | undefined;
    if (statusInput !== undefined) {
      nextStatus = normalizeAllowedValue(statusInput, APPROVAL_DEFINITION_STATUSES);
    }
    const hasStatus = nextStatus !== undefined;
    // 审计动作：仅 status → 沿用 STATUS；含 update 字段 → 合并入 UPDATE 条目（两段合并）。
    const auditAction = hasStatus && !hasUpdateFields
      ? 'APPROVAL_DEFINITION_STATUS'
      : 'APPROVAL_DEFINITION_UPDATE';

    const updated = await this.prisma.$transaction(async tx => {
      const existing = await tx.approvalDefinition.findUnique({ where: { code: definitionCode } });
      if (existing && ['SOP_REVIEW','QUALITY_ANALYSIS'].includes(existing.businessType)) throw new MasterDataError('SOP_REVIEW_ROUTING_FIXED',409);
      if (!existing) {
        throw new ApprovalError(
          APPROVAL_ERROR_CODES.APPROVAL_DEFINITION_NOT_FOUND,
          404,
          'approval definition not found',
        );
      }
      const fromVersion = existing.version;
      const fromStatus = existing.status;
      let toStatus: string | undefined;
      let row = existing;
      // 第一段守卫版本：客户端 version 前置条件（若提供）否则锁前读版本；update 段先跑则消耗之，
      // status 段沿用 update 后版本（同一事务内行锁持有，重读即最新）。
      let guardVersion = versionPrecondition ?? existing.version;

      if (hasUpdateFields) {
        const flipped = await tx.approvalDefinition.updateMany({
          where: { code: definitionCode, version: guardVersion },
          data,
        });
        if (flipped.count === 0) {
          throw new ApprovalError(
            APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID,
            409,
            'approval definition state changed concurrently',
          );
        }
        row = await tx.approvalDefinition.findUniqueOrThrow({ where: { code: definitionCode } });
        guardVersion = row.version;
      }

      if (hasStatus) {
        const flipped = await tx.approvalDefinition.updateMany({
          where: { code: definitionCode, version: guardVersion },
          data: { status: nextStatus, version: { increment: 1 } },
        });
        if (flipped.count === 0) {
          throw new ApprovalError(
            APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID,
            409,
            'approval definition state changed concurrently',
          );
        }
        row = await tx.approvalDefinition.findUniqueOrThrow({ where: { code: definitionCode } });
        toStatus = row.status;
      }

      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: auditAction,
          targetType: 'APPROVAL_DEFINITION',
          targetId: row.id,
          newValues: JSON.stringify({
            definitionId: row.id,
            code: row.code,
            businessType: row.businessType,
            fromVersion,
            toVersion: row.version,
            changedFields,
            ...(hasStatus ? { fromStatus, toStatus } : {}),
          }),
          ip: this.actor.ip,
        },
      });
      return row;
    });
    return projectApprovalDefinition(updated);
  }

  /** 全量定义（含 DISABLED）：approval.manage → code 升序，无分页（定义规模小）。 */
  async listAllDefinitions(): Promise<ApprovalDefinitionView[]> {
    this.authorization.requireAction(this.authorizationContext, 'approval.manage');
    const rows = await this.prisma.approvalDefinition.findMany({
      where: {businessType:{notIn:['SOP_REVIEW','QUALITY_ANALYSIS']}},
      orderBy: [{ code: 'asc' }],
    });
    return rows.map(projectApprovalDefinition);
  }

  /**
   * SPEC-025/029 导出：approval.manage → { schemaVersion, definitions } 包络。
   * SPEC-029 增量导出：可选 codes（≤100）/ businessType 筛选；缺省全量含 DISABLED code 升序
   * （向后兼容）。导出为读操作不落审计（D1/D2/D9）。
   */
  async exportDefinitions(query?: ExportDefinitionsQuery): Promise<DefinitionExportPayload> {
    this.authorization.requireAction(this.authorizationContext, 'approval.manage');
    assertExactKeys(query ?? {}, ['codes', 'businessType']);
    const where: Prisma.ApprovalDefinitionWhereInput = {AND:[{businessType:{notIn:['SOP_REVIEW','QUALITY_ANALYSIS']}}]};
    if (query?.businessType !== undefined) {
      where.businessType = normalizeAllowedValue(query.businessType, APPROVAL_BUSINESS_TYPES);
    }
    if (query?.codes !== undefined) {
      where.code = { in: normalizeCodeList(query.codes) };
    }
    const rows = await this.prisma.approvalDefinition.findMany({
      where,
      orderBy: [{ code: 'asc' }],
    });
    return {
      schemaVersion: DEFINITION_EXPORT_SCHEMA_VERSION,
      definitions: rows.map(projectApprovalDefinition),
    };
  }

  /**
   * SPEC-025 批量导入：approval.manage → assertExactKeys + normalize definitions 数组
   * （上限 100 超限 → 400）→ 单 $transaction 逐定义 upsert（按 code）：
   * - 已存在 → update（复用 create/update 校验 + version 前置条件：input.version 提供且
   *   !== existing.version → 409 APPROVAL_STATE_INVALID；version+1，status 可选）；
   * - 不存在 → create（复用校验，version 1/ACTIVE，createdBy=actor）；
   * - 单事务全或无（任一定义校验失败/version 冲突 → 整事务回滚零写入）。
   * 幂等按 code（D3/D4/D5）。审计 APPROVAL_DEFINITION_IMPORT（newValues 含
   * imported/updated/count/summary）。返回 { imported, updated }。
   */
  async importDefinitions(input: ImportDefinitionsInput): Promise<ImportResult> {
    this.authorization.requireAction(this.authorizationContext, 'approval.manage');
    const rawDefinitions = input.definitions;
    assertExactKeys(input, ['schemaVersion', 'definitions']);
    // SPEC-029 格式版本：undefined/1 兼容（旧导出无 schemaVersion 视为 1）；>1 → 400（未来格式）。
    const schemaVersion = input.schemaVersion === undefined ? 1 : normalizeVersion(input.schemaVersion);
    if (schemaVersion !== DEFINITION_EXPORT_SCHEMA_VERSION) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    if (!Array.isArray(rawDefinitions)) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    if (rawDefinitions.length > 100) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    // SPEC-029 关联角色供给校验：收集全部定义 approverRule.roleCodes → 校验角色存在（ENABLED）。
    // 缺失 → 400 明确报错（含缺失角色码，提示跑 bootstrap 供给）；不自动建角色。
    await this.assertImportedRolesExist(rawDefinitions);

    return this.prisma.$transaction(async tx => {
      let imported = 0;
      let updated = 0;
      for (const rawDef of rawDefinitions) {
        // assertExactKeys 会把入参收窄为 Record<string, unknown>，故先捕获 Json 字段保类型。
        const formSchema = rawDef.formSchema;
        const approverRule = rawDef.approverRule;
        const nodeSchema = rawDef.nodeSchema ?? null;
        assertExactKeys(rawDef, ['code', 'name', 'businessType', 'formSchema', 'approverRule', 'nodeSchema', 'version', 'status']);
        const code = normalizeRequiredText(rawDef.code, 1, 100);
        if (!APPROVAL_DEFINITION_CODE_PATTERN.test(code)) {
          throw new MasterDataError('VALIDATION_FAILED', 400);
        }
        const name = normalizeRequiredText(rawDef.name, 1, 100);
        const businessType = normalizeAllowedValue(rawDef.businessType, APPROVAL_BUSINESS_TYPES);
        if (['SOP_REVIEW','QUALITY_ANALYSIS'].includes(businessType) || code.startsWith('SOP_') || code.startsWith('QUALITY_')) throw new MasterDataError('SOP_REVIEW_ADAPTER_REQUIRED',409);
        const status = rawDef.status === undefined
          ? undefined
          : normalizeAllowedValue(rawDef.status, APPROVAL_DEFINITION_STATUSES);
        const version = rawDef.version === undefined ? undefined : normalizeVersion(rawDef.version);
        this.assertNodeSchemaValid(nodeSchema);
        this.assertFormSchemaValid(formSchema);
        this.assertApproverRuleValid(approverRule);

        const existing = await tx.approvalDefinition.findUnique({ where: { code } });
        if (existing && ['SOP_REVIEW','QUALITY_ANALYSIS'].includes(existing.businessType)) throw new MasterDataError('SOP_REVIEW_ROUTING_FIXED',409);
        if (existing) {
          // version 前置条件（可选）：提供且 !== existing.version → 409 整事务回滚。
          if (version !== undefined && version !== existing.version) {
            throw new ApprovalError(
              APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID,
              409,
              'approval definition state changed concurrently',
            );
          }
          const data: Prisma.ApprovalDefinitionUpdateManyMutationInput = {
            name,
            formSchema,
            approverRule,
            nodeSchema: nodeSchema === null ? Prisma.DbNull : nodeSchema,
            version: { increment: 1 },
          };
          if (status !== undefined) {
            data.status = status;
          }
          const flipped = await tx.approvalDefinition.updateMany({
            where: { code, version: existing.version },
            data,
          });
          if (flipped.count === 0) {
            throw new ApprovalError(
              APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID,
              409,
              'approval definition state changed concurrently',
            );
          }
          updated += 1;
        } else {
          await tx.approvalDefinition.create({
            data: {
              code,
              name,
              businessType,
              formSchema,
              approverRule,
              nodeSchema: nodeSchema === null ? Prisma.DbNull : nodeSchema,
              status: status ?? 'ACTIVE',
              createdBy: this.actor.actorUserId,
            },
          });
          imported += 1;
        }
      }
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'APPROVAL_DEFINITION_IMPORT',
          targetType: 'APPROVAL_DEFINITION',
          targetId: 'IMPORT',
          newValues: JSON.stringify({
            imported,
            updated,
            count: imported + updated,
            summary: `imported ${imported}, updated ${updated}`,
          }),
          ip: this.actor.ip,
        },
      });
      return { imported, updated };
    });
  }

  /**
   * SPEC-029 关联角色供给校验：收集全部导入定义 approverRule.roleCodes（含 nodeSchema 节点
   * approverRule）→ 查询 role 存在性（status ENABLED）；缺失 → 400 明确报错（含缺失角色码，
   * 提示先跑 bootstrap 供给）。**不自动建角色**（沿 SPEC-015 bootstrap 供给纪律）。
   */
  private async assertImportedRolesExist(rawDefinitions: unknown[]): Promise<void> {
    const roleCodes = new Set<string>();
    const collectRoleCodes = (rule: unknown): void => {
      if (!rule || typeof rule !== 'object') return;
      const candidate = rule as { type?: unknown; roleCodes?: unknown };
      if (candidate.type === 'ROLE' && Array.isArray(candidate.roleCodes)) {
        for (const code of candidate.roleCodes) {
          if (typeof code === 'string' && code.length > 0) roleCodes.add(code);
        }
      }
    };
    for (const rawDef of rawDefinitions) {
      if (!rawDef || typeof rawDef !== 'object') continue;
      const def = rawDef as { approverRule?: unknown; nodeSchema?: unknown };
      collectRoleCodes(def.approverRule);
      if (Array.isArray(def.nodeSchema)) {
        for (const node of def.nodeSchema) {
          if (node && typeof node === 'object') collectRoleCodes((node as { approverRule?: unknown }).approverRule);
        }
      }
    }
    if (roleCodes.size === 0) return;
    const existing = await this.prisma.role.findMany({
      where: { code: { in: [...roleCodes] }, status: 'ENABLED' },
      select: { code: true },
    });
    const existingCodes = new Set(existing.map(role => role.code));
    const missing = [...roleCodes].filter(code => !existingCodes.has(code));
    if (missing.length > 0) {
      // MasterDataError 无 message 参数（code 即 message）——用明确错误码标识缺失角色（提示跑 bootstrap 供给）。
      throw new MasterDataError('IMPORTED_ROLE_NOT_FOUND', 400);
    }
  }

  /**
   * nodeSchema 校验（沿 SPEC-016 buildApprovalChain 语义本地镜像）：null/undefined 合法
   * （顶层 approverRule 单节点）；非空数组 → 逐元素 {name: string, approverRule: Json, mode?}；
   * 空数组/非数组对象 → APPROVAL_ASSIGNEE_INVALID 400。SPEC-018：逐节点 mode 若存在且
   * ∉ {'ANY','ALL'} → APPROVAL_ASSIGNEE_INVALID 400（与 buildApprovalChain 同型本地镜像——
   * create/update 定义时即拒畸形 mode，防静默）。
   */
  private assertNodeSchemaValid(nodeSchema: Prisma.InputJsonValue | null): void {
    if (nodeSchema === null || nodeSchema === undefined) return;
    if (!Array.isArray(nodeSchema)) {
      throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'approval node schema is malformed');
    }
    if (nodeSchema.length === 0) {
      throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'approval node schema is empty');
    }
    // SPEC-018 minor 加固（Task 1 ⚠️②）：节点名须唯一——processTask ALL 分支的
    // remainingPending 按 nodeName 计数（approvalTask.count({instanceId, nodeName, ...})），
    // 跨节点同名会误计；定义校验拒绝重复名，防运行期错误。
    const seenNames = new Set<string>();
    for (const node of nodeSchema) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) {
        throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'approval node schema is malformed');
      }
      const { name, approverRule, mode } = node as { name?: unknown; approverRule?: unknown; mode?: unknown };
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'approval node schema is malformed');
      }
      const trimmedName = name.trim();
      if (seenNames.has(trimmedName)) {
        throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'approval node name must be unique');
      }
      seenNames.add(trimmedName);
      if (mode !== undefined && mode !== 'ANY' && mode !== 'ALL') {
        throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'approval node mode is invalid');
      }
      this.assertApproverRuleValid(approverRule);
    }
  }

  /** approverRule 校验：非空对象 {type ∈ USER|ROLE, userIds?/roleCodes? 数组}。 */
  private assertApproverRuleValid(rule: unknown): void {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'approver rule is malformed');
    }
    const { type, userIds, roleCodes, levels } = rule as { type?: unknown; userIds?: unknown; roleCodes?: unknown; levels?: unknown };
    if (type === 'USER') {
      if (!Array.isArray(userIds)) {
        throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'approver rule is malformed');
      }
      return;
    }
    if (type === 'ROLE') {
      if (!Array.isArray(roleCodes)) {
        throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'approver rule is malformed');
      }
      return;
    }
    // SPEC-041：SUPERVISOR 规则——levels 若存在必须整数 ≥1（缺省 1=直属上级）。
    if (type === 'SUPERVISOR') {
      if (levels !== undefined && (typeof levels !== 'number' || !Number.isInteger(levels) || levels < 1)) {
        throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'approver rule is malformed');
      }
      return;
    }
    throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'approver rule is malformed');
  }

  /** formSchema 校验：非空对象含 fields 数组；每字段 {key/label/type∈date|text|textarea|number/required?}。 */
  private assertFormSchemaValid(formSchema: unknown): void {
    if (!formSchema || typeof formSchema !== 'object' || Array.isArray(formSchema)) {
      throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'form schema is malformed');
    }
    const { fields } = formSchema as { fields?: unknown };
    if (!Array.isArray(fields)) {
      throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'form schema is malformed');
    }
    for (const field of fields) {
      if (!field || typeof field !== 'object' || Array.isArray(field)) {
        throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'form schema is malformed');
      }
      const { key, label, type, required } = field as { key?: unknown; label?: unknown; type?: unknown; required?: unknown };
      if (typeof key !== 'string' || key.trim().length === 0) {
        throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'form schema is malformed');
      }
      if (typeof label !== 'string' || label.trim().length === 0) {
        throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'form schema is malformed');
      }
      if (typeof type !== 'string' || !FORM_FIELD_TYPES.includes(type as typeof FORM_FIELD_TYPES[number])) {
        throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'form schema is malformed');
      }
      if (required !== undefined && typeof required !== 'boolean') {
        throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_ASSIGNEE_INVALID, 400, 'form schema is malformed');
      }
    }
  }
}

/** SPEC-029 增量导出 code 列表规范化：必填非空数组（≤100），每项 1-100 去重——非法 → 400。 */
function normalizeCodeList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  const normalized = value.map(item => normalizeRequiredText(item, 1, 100));
  return [...new Set(normalized)];
}
