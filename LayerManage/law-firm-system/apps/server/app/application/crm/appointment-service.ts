// SPEC-009 Task 8: appointment-service —— 谈案邀约（创建/改期/到访/爽约/取消/查询）。
// 事务边界（设计 §6.2）：业务写入、lead 状态推进、EventLog（outbox append）、OperationLog
//   全部同事务；不依赖事件往返。
// 动作权限（决策 4）：createAppointment/reschedule=appointment.create；
//   confirmVisit/markNoShow/cancel=appointment.visit；list/get=appointment.read。
//   每个公开方法首条语句即 AuthorizationService.requireAction。
// 数据范围（决策 5）：Appointment 无组织列——resolveScopeTargets(context,'appointment',code)
//   取三分量后锚定 LEAD 关系列：SELF→lead.assignedTo、TEAM→lead.professionalTeamId、
//   BRANCH/ORG→lead.branchId（组织子树展开）、ALL→不过滤；多范围 OR 并集，零谓词 fail-closed；
//   越权一律 LEAD_NOT_FOUND(404)，不泄露邀约存在性。
// 冲突与幂等（决策 6）：同 leadId + 状态 IN (PENDING,CONFIRMED) + scheduledAt 精确相等为冲突槽；
//   命中且 createdBy=actor → 幂等回放返回既有行（不写新行/事件）；否则 APPOINTMENT_CONFLICT(409)。
// 状态联动：创建置 PENDING，lead 仅当 canTransition(current,'INVITED') 时推进 INVITED 并同事务发
//   lead.status_changed v1，恒发 appointment.created v1（决策 6）；confirmVisit 仅
//   PENDING|CONFIRMED→VISITED，lead 仅当 canTransition(current,'VISITED') 时推进，恒发
//   appointment.visited v1（决策 7）；markNoShow/cancel/reschedule 无事件、lead 不动（决策 8/9）。
// 改期（决策 9）：旧行→RESCHEDULED + 新行 PENDING（rescheduledFromId=旧 id，沿用 channel/
//   negotiatorEmployeeId/remark），新槽位套用冲突规则但同创建人回放不适用（恒为新行）。
// 并发：Appointment 无 version 列——写操作以"读时状态"做 updateMany 条件守护（compare-and-set），
//   count≠1 抛 VERSION_CONFLICT(409)；lead 推进仍走 Lead.version 乐观锁。appointmentNo 碰撞
//   P2002 重试上限 2（同 lead-service 纪律）。
// 审计：OperationLog 只落安全字段（appointmentNo/leadId/scheduledAt/channel/status 等），
//   禁止 remark 自由文本。邀约无 L3 字段，输出不脱敏、不落 READ_L3_FIELDS。
// 2026-07-29 用户裁定（Task 10 收官后纯追加）：listAppointmentsByRange —— 到访日历跨线索
//   范围查询，支撑 VisitCalendarPage；未改动任何既有方法。

import { randomUUID } from 'node:crypto';

import { Appointment, Lead, Prisma, PrismaClient } from '@prisma/client';

import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { buildOrganizationScopeWhere } from '../authorization/resource-scope-resolvers';
import { EventOutboxWriter, PrismaEventOutboxWriter } from '../events/event-outbox-writer';
import { AuditActor } from '../master-data/master-data-types';
import { PermissionCode } from '../../domain/authorization/authorization-types';
import {
  APPOINTMENT_CONFLICT,
  CrmError,
  LEAD_NOT_FOUND,
  LEAD_STATE_TRANSITION_INVALID,
} from '../../domain/crm/lead-errors';
import { AppointmentStatus, canTransition, LeadStatus } from '../../domain/crm/lead-policy';
import {
  APPOINTMENT_CREATED,
  APPOINTMENT_VISITED,
  AppointmentCreatedV1,
  AppointmentVisitedV1,
  EventEnvelopeInput,
  LEAD_STATUS_CHANGED,
  LeadStatusChangedV1,
} from '../../domain/events/event-types';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeOptionalText,
  normalizeRequiredText,
} from '../../domain/master-data/master-data-validation';
import { makeBusinessNo } from './business-no';
import { PagedResult } from './lead-types';

// 业务编号冲突重试上限（设计 §10，同 lead-service）。
const BUSINESS_NO_RETRY_LIMIT = 2;

// 分页缺省/上限（同 lead-service/customer-service 纪律）。
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** 日历范围查询跨度上限（全表扫描护栏）：366 天（毫秒）。 */
const RANGE_SPAN_CAP_MS = 366 * 24 * 60 * 60 * 1000;

/** schema Appointment.channel 取值。 */
export const APPOINTMENT_CHANNELS = ['ONSITE', 'ONLINE'] as const;
export type AppointmentChannel = (typeof APPOINTMENT_CHANNELS)[number];

/** 可执行到访/爽约/取消/改期的活动状态。 */
const ACTIVE_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = ['PENDING', 'CONFIRMED'];

/** 决策 6：这些 lead 状态禁止再发起邀约。 */
const APPOINTMENT_FORBIDDEN_LEAD_STATUSES: ReadonlySet<LeadStatus> = new Set<LeadStatus>([
  'CONVERTED',
  'LOST',
  'NURTURE',
]);

export interface CreateAppointmentInput {
  scheduledAt: Date;
  channel: AppointmentChannel;
  negotiatorEmployeeId?: string;
  remark?: string;
}

/** Appointment 输出视图：无 L3 字段，remark 明文可见。 */
export interface AppointmentView {
  id: string;
  appointmentNo: string;
  leadId: string;
  scheduledAt: Date;
  channel: string;
  negotiatorEmployeeId: string | null;
  status: AppointmentStatus;
  rescheduledFromId: string | null;
  remark: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 到访日历范围查询入参（2026-07-29 裁定追加）：from/to 双端含，跨度 ≤ 366 天。 */
export interface AppointmentRangeQuery {
  from: Date;
  to: Date;
  page?: number;
  pageSize?: number;
}

export class AppointmentService {
  private readonly authorization: AuthorizationService;
  private readonly outbox: EventOutboxWriter;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
    outbox?: EventOutboxWriter,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
    this.outbox = outbox ?? new PrismaEventOutboxWriter();
  }

  /**
   * 创建邀约（决策 4/5/6）：appointment.create 权限 → lead 可见且未删除且非
   * CONVERTED/LOST/NURTURE → 活动槽冲突（同创建人回放返回既有行，他人 409）→
   * 同事务建 PENDING 邀约 + 可推进时 lead=INVITED（version 锁 + status_changed 事件）+
   * appointment.created 事件 + OperationLog。appointmentNo=makeBusinessNo('AP')，P2002 重试一次。
   */
  async createAppointment(leadId: string, input: CreateAppointmentInput): Promise<AppointmentView> {
    this.authorization.requireAction(this.authorizationContext, 'appointment.create');
    const id = normalizeRequiredText(leadId, 1, 100);
    assertExactKeys(input, ['scheduledAt', 'channel', 'negotiatorEmployeeId', 'remark']);
    const scheduledAt = normalizeRequiredDateTime(input.scheduledAt);
    const channel = normalizeAllowedValue(input.channel, APPOINTMENT_CHANNELS);
    const negotiatorEmployeeId = normalizeOptionalText(input.negotiatorEmployeeId, 100);
    const remark = normalizeOptionalText(input.remark, 500);
    const leadScopeWhere = await this.buildAppointmentLeadScopeWhere('appointment.create');

    for (let attempt = 0; attempt < BUSINESS_NO_RETRY_LIMIT; attempt += 1) {
      try {
        const result = await this.prisma.$transaction(async tx => {
          const lead = await tx.lead.findFirst({
            where: { AND: [leadScopeWhere, { id, deletedAt: null }] },
          });
          if (!lead) throw new CrmError(LEAD_NOT_FOUND, 404, 'lead not found');
          if (APPOINTMENT_FORBIDDEN_LEAD_STATUSES.has(lead.status as LeadStatus)) {
            throw new CrmError(
              LEAD_STATE_TRANSITION_INVALID,
              409,
              `cannot create appointment for lead in ${lead.status}`,
            );
          }

          const conflict = await tx.appointment.findFirst({
            where: {
              leadId: lead.id,
              status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
              scheduledAt,
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          });
          if (conflict) {
            // 决策 6：同创建人命中既有活动槽 → 幂等回放，不写新行/事件。
            if (conflict.createdBy === this.actor.actorUserId) return conflict;
            throw new CrmError(APPOINTMENT_CONFLICT, 409, 'appointment slot already taken');
          }

          const appointment = await tx.appointment.create({
            data: {
              appointmentNo: makeBusinessNo('AP'),
              leadId: lead.id,
              scheduledAt,
              channel,
              negotiatorEmployeeId,
              remark,
              status: 'PENDING',
              createdBy: this.actor.actorUserId,
            },
          });

          // lead 推进：仅 SCREENED→INVITED 在状态机内；其余状态不动、无事件。
          const fromStatus = lead.status as LeadStatus;
          if (canTransition(fromStatus, 'INVITED')) {
            const promoted = await tx.lead.updateMany({
              where: { id: lead.id, version: lead.version },
              data: { status: 'INVITED', updatedBy: this.actor.actorUserId, version: { increment: 1 } },
            });
            if (promoted.count !== 1) throw new MasterDataError('VERSION_CONFLICT', 409);
            const statusPayload: LeadStatusChangedV1 = {
              leadId: lead.id,
              fromStatus,
              toStatus: 'INVITED',
            };
            await this.outbox.append(tx, this.envelope('LEAD', lead.id, statusPayload, lead, LEAD_STATUS_CHANGED));
          }

          const createdPayload: AppointmentCreatedV1 = {
            appointmentId: appointment.id,
            leadId: lead.id,
            channel,
            status: 'PENDING',
          };
          await this.outbox.append(
            tx,
            this.envelope('APPOINTMENT', appointment.id, createdPayload, lead, APPOINTMENT_CREATED),
          );
          await tx.operationLog.create({
            data: {
              userId: this.actor.actorUserId,
              action: 'APPOINTMENT_CREATE',
              targetType: 'APPOINTMENT',
              targetId: appointment.id,
              // 审计只落安全字段：禁止 remark 自由文本。
              newValues: JSON.stringify({
                appointmentNo: appointment.appointmentNo,
                leadId: lead.id,
                scheduledAt: scheduledAt.toISOString(),
                channel,
                status: appointment.status,
              }),
              ip: this.actor.ip,
            },
          });
          return appointment;
        });
        return projectAppointment(result);
      } catch (error) {
        if (attempt + 1 < BUSINESS_NO_RETRY_LIMIT && isUniqueConflictOn(error, 'appointmentNo')) continue;
        throw error;
      }
    }
    throw new Error('unreachable');
  }

  /**
   * 确认到访（决策 7）：仅 PENDING|CONFIRMED→VISITED（否则 409）；同事务 lead 仅当
   * canTransition(current,'VISITED') 时推进（version 锁 + status_changed 事件）；
   * 恒发 appointment.visited v1。
   */
  async confirmVisit(appointmentId: string): Promise<AppointmentView> {
    this.authorization.requireAction(this.authorizationContext, 'appointment.visit');
    const id = normalizeRequiredText(appointmentId, 1, 100);
    const scopeWhere = await this.buildAppointmentScopeWhere('appointment.visit');

    return this.prisma.$transaction(async tx => {
      const appointment = await tx.appointment.findFirst({ where: { AND: [scopeWhere, { id }] } });
      if (!appointment) throw new CrmError(LEAD_NOT_FOUND, 404, 'appointment not found');
      assertActiveAppointment(appointment.status as AppointmentStatus);

      const changed = await tx.appointment.updateMany({
        where: { id: appointment.id, status: appointment.status },
        data: { status: 'VISITED' },
      });
      if (changed.count !== 1) throw new MasterDataError('VERSION_CONFLICT', 409);

      const lead = await tx.lead.findUniqueOrThrow({ where: { id: appointment.leadId } });
      const fromStatus = lead.status as LeadStatus;
      if (canTransition(fromStatus, 'VISITED')) {
        const promoted = await tx.lead.updateMany({
          where: { id: lead.id, version: lead.version },
          data: { status: 'VISITED', updatedBy: this.actor.actorUserId, version: { increment: 1 } },
        });
        if (promoted.count !== 1) throw new MasterDataError('VERSION_CONFLICT', 409);
        const statusPayload: LeadStatusChangedV1 = {
          leadId: lead.id,
          fromStatus,
          toStatus: 'VISITED',
        };
        await this.outbox.append(tx, this.envelope('LEAD', lead.id, statusPayload, lead, LEAD_STATUS_CHANGED));
      }

      const visitedPayload: AppointmentVisitedV1 = {
        appointmentId: appointment.id,
        leadId: lead.id,
        status: 'VISITED',
      };
      await this.outbox.append(
        tx,
        this.envelope('APPOINTMENT', appointment.id, visitedPayload, lead, APPOINTMENT_VISITED),
      );
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'APPOINTMENT_VISIT',
          targetType: 'APPOINTMENT',
          targetId: appointment.id,
          newValues: JSON.stringify({
            appointmentNo: appointment.appointmentNo,
            leadId: lead.id,
            status: 'VISITED',
          }),
          ip: this.actor.ip,
        },
      });
      return tx.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    }).then(projectAppointment);
  }

  /** 爽约（决策 8）：PENDING|CONFIRMED→NOSHOW；无事件；lead 不动。 */
  async markNoShow(appointmentId: string): Promise<AppointmentView> {
    return this.transitionToTerminal(appointmentId, 'NOSHOW', 'APPOINTMENT_NOSHOW');
  }

  /** 取消（决策 8）：PENDING|CONFIRMED→CANCELLED；无事件；lead 不动。 */
  async cancel(appointmentId: string): Promise<AppointmentView> {
    return this.transitionToTerminal(appointmentId, 'CANCELLED', 'APPOINTMENT_CANCEL');
  }

  /**
   * 改期（决策 9）：仅 PENDING|CONFIRMED（否则 409）；同事务旧行→RESCHEDULED（状态守护 CAS）+
   * 新行 PENDING（rescheduledFromId=旧 id，沿用 channel/negotiatorEmployeeId/remark，新
   * appointmentNo）；新槽位冲突任一创建人均 409（同创建人回放不适用）；无事件。
   */
  async reschedule(appointmentId: string, newScheduledAt: Date): Promise<AppointmentView> {
    this.authorization.requireAction(this.authorizationContext, 'appointment.create');
    const id = normalizeRequiredText(appointmentId, 1, 100);
    const scheduledAt = normalizeRequiredDateTime(newScheduledAt);
    const scopeWhere = await this.buildAppointmentScopeWhere('appointment.create');

    for (let attempt = 0; attempt < BUSINESS_NO_RETRY_LIMIT; attempt += 1) {
      try {
        const result = await this.prisma.$transaction(async tx => {
          const old = await tx.appointment.findFirst({ where: { AND: [scopeWhere, { id }] } });
          if (!old) throw new CrmError(LEAD_NOT_FOUND, 404, 'appointment not found');
          assertActiveAppointment(old.status as AppointmentStatus);

          // 新槽位冲突规则（决策 6 套用；排除旧行自身；同创建人回放不适用 → 一律 409）。
          const conflict = await tx.appointment.findFirst({
            where: {
              leadId: old.leadId,
              status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
              scheduledAt,
              id: { not: old.id },
            },
            select: { id: true },
          });
          if (conflict) throw new CrmError(APPOINTMENT_CONFLICT, 409, 'appointment slot already taken');

          const archived = await tx.appointment.updateMany({
            where: { id: old.id, status: old.status },
            data: { status: 'RESCHEDULED' },
          });
          if (archived.count !== 1) throw new MasterDataError('VERSION_CONFLICT', 409);

          const created = await tx.appointment.create({
            data: {
              appointmentNo: makeBusinessNo('AP'),
              leadId: old.leadId,
              scheduledAt,
              channel: old.channel,
              negotiatorEmployeeId: old.negotiatorEmployeeId,
              remark: old.remark,
              status: 'PENDING',
              rescheduledFromId: old.id,
              createdBy: this.actor.actorUserId,
            },
          });
          await tx.operationLog.create({
            data: {
              userId: this.actor.actorUserId,
              action: 'APPOINTMENT_RESCHEDULE',
              targetType: 'APPOINTMENT',
              targetId: created.id,
              newValues: JSON.stringify({
                appointmentNo: created.appointmentNo,
                leadId: old.leadId,
                rescheduledFromId: old.id,
                scheduledAt: scheduledAt.toISOString(),
                status: created.status,
              }),
              ip: this.actor.ip,
            },
          });
          return created;
        });
        return projectAppointment(result);
      } catch (error) {
        if (attempt + 1 < BUSINESS_NO_RETRY_LIMIT && isUniqueConflictOn(error, 'appointmentNo')) continue;
        throw error;
      }
    }
    throw new Error('unreachable');
  }

  /** 邀约详情（决策 4/5）：appointment.read 权限 + 范围（经 lead 关系）；不可见 404。 */
  async getAppointment(appointmentId: string): Promise<AppointmentView> {
    this.authorization.requireAction(this.authorizationContext, 'appointment.read');
    const id = normalizeRequiredText(appointmentId, 1, 100);
    const scopeWhere = await this.buildAppointmentScopeWhere('appointment.read');
    const appointment = await this.prisma.appointment.findFirst({ where: { AND: [scopeWhere, { id }] } });
    if (!appointment) throw new CrmError(LEAD_NOT_FOUND, 404, 'appointment not found');
    return projectAppointment(appointment);
  }

  /** 某线索的邀约列表（决策 4/5）：lead 不可见/不存在 → 404；按 scheduledAt ASC（id ASC 决胜）。 */
  async listAppointments(leadId: string): Promise<AppointmentView[]> {
    this.authorization.requireAction(this.authorizationContext, 'appointment.read');
    const id = normalizeRequiredText(leadId, 1, 100);
    const leadScopeWhere = await this.buildAppointmentLeadScopeWhere('appointment.read');
    const lead = await this.prisma.lead.findFirst({
      where: { AND: [leadScopeWhere, { id, deletedAt: null }] },
      select: { id: true },
    });
    if (!lead) throw new CrmError(LEAD_NOT_FOUND, 404, 'lead not found');
    const appointments = await this.prisma.appointment.findMany({
      where: { leadId: lead.id },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
    });
    return appointments.map(projectAppointment);
  }

  /**
   * 到访日历范围查询（2026-07-29 用户裁定，Task 10 收官后纯追加）：appointment.read 权限 +
   * 数据范围（复用 buildAppointmentScopeWhere 的 lead 关系包装）+ lead 未软删 +
   * scheduledAt ∈ [from, to]（双端含，日历语义）；from > to 或跨度 > 366 天拒绝
   * （VALIDATION_FAILED 400，全表扫描护栏）；按 scheduledAt ASC（id ASC 决胜）分页返回。
   */
  async listAppointmentsByRange(query: AppointmentRangeQuery): Promise<PagedResult<AppointmentView>> {
    this.authorization.requireAction(this.authorizationContext, 'appointment.read');
    assertExactKeys(query, ['from', 'to', 'page', 'pageSize']);
    const from = normalizeRequiredDateTime(query.from);
    const to = normalizeRequiredDateTime(query.to);
    if (from.getTime() > to.getTime()) throw new MasterDataError('VALIDATION_FAILED', 400);
    if (to.getTime() - from.getTime() > RANGE_SPAN_CAP_MS) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const scopeWhere = await this.buildAppointmentScopeWhere('appointment.read');

    const where: Prisma.AppointmentWhereInput = {
      AND: [
        scopeWhere,
        { lead: { deletedAt: null } },
        { scheduledAt: { gte: from, lte: to } },
      ],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.appointment.count({ where }),
      this.prisma.appointment.findMany({
        where,
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      list: rows.map(projectAppointment),
      page,
      pageSize,
      total,
    };
  }

  /** markNoShow/cancel 共用：活动状态 → 终态（状态守护 CAS），无事件、不动 lead。 */
  private async transitionToTerminal(
    appointmentId: string,
    target: 'NOSHOW' | 'CANCELLED',
    auditAction: string,
  ): Promise<AppointmentView> {
    this.authorization.requireAction(this.authorizationContext, 'appointment.visit');
    const id = normalizeRequiredText(appointmentId, 1, 100);
    const scopeWhere = await this.buildAppointmentScopeWhere('appointment.visit');

    return this.prisma.$transaction(async tx => {
      const appointment = await tx.appointment.findFirst({ where: { AND: [scopeWhere, { id }] } });
      if (!appointment) throw new CrmError(LEAD_NOT_FOUND, 404, 'appointment not found');
      assertActiveAppointment(appointment.status as AppointmentStatus);

      const changed = await tx.appointment.updateMany({
        where: { id: appointment.id, status: appointment.status },
        data: { status: target },
      });
      if (changed.count !== 1) throw new MasterDataError('VERSION_CONFLICT', 409);

      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: auditAction,
          targetType: 'APPOINTMENT',
          targetId: appointment.id,
          newValues: JSON.stringify({
            appointmentNo: appointment.appointmentNo,
            leadId: appointment.leadId,
            status: target,
          }),
          ip: this.actor.ip,
        },
      });
      return tx.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    }).then(projectAppointment);
  }

  /**
   * appointment 数据范围（决策 5）：锚定 LEAD 关系列的三分量组装，语义同
   * lead-scope buildLeadScopeWhere（OR 并集 / 零谓词 fail-closed / ALL 不过滤），
   * 仅资源与权限码换成 appointment.*。返回 LeadWhereInput 供直接查 lead（创建/列表前置校验）。
   */
  private async buildAppointmentLeadScopeWhere(permissionCode: PermissionCode): Promise<Prisma.LeadWhereInput> {
    const resolution = await this.authorization.resolveScopeTargets(
      this.authorizationContext,
      'appointment',
      permissionCode,
    );
    if (resolution.all) return {};

    const predicates: Prisma.LeadWhereInput[] = [];
    if (resolution.employeeIds.length > 0) {
      predicates.push({ assignedTo: { in: resolution.employeeIds } });
    }
    if (resolution.professionalTeamIds.length > 0) {
      predicates.push({ professionalTeamId: { in: resolution.professionalTeamIds } });
    }
    if (resolution.organizationTargets.length > 0) {
      // buildOrganizationScopeWhere 只读取 organizationTargets 分量（此处 all 必为 false）。
      const organizations = await this.prisma.organization.findMany({
        where: buildOrganizationScopeWhere(resolution),
        select: { id: true },
      });
      if (organizations.length > 0) {
        predicates.push({ branchId: { in: organizations.map(organization => organization.id) } });
      }
    }
    if (predicates.length === 0) return { id: { in: [] } };
    return { OR: predicates };
  }

  /** 邀约行级范围：包装 lead 关系谓词为 AppointmentWhereInput（fail-closed 经 lead 匹配不到任何行）。 */
  private async buildAppointmentScopeWhere(permissionCode: PermissionCode): Promise<Prisma.AppointmentWhereInput> {
    const leadWhere = await this.buildAppointmentLeadScopeWhere(permissionCode);
    return { lead: leadWhere };
  }

  /** 事件信封（同 lead-service 模式：branch/team 取 Lead 行原样透传）。 */
  private envelope(
    objectType: 'LEAD' | 'APPOINTMENT',
    objectId: string,
    payload: unknown,
    lead: Pick<Lead, 'branchId' | 'professionalTeamId'>,
    eventType: string,
  ): EventEnvelopeInput {
    return {
      eventType,
      eventVersion: 1,
      objectType,
      objectId,
      operatorUserId: this.actor.actorUserId,
      organizationId: null,
      branchId: lead.branchId ?? null,
      teamId: lead.professionalTeamId ?? null,
      payload,
      traceId: this.actor.requestId ?? randomUUID(),
      occurredAt: new Date(),
    };
  }
}

function projectAppointment(appointment: Appointment): AppointmentView {
  return {
    id: appointment.id,
    appointmentNo: appointment.appointmentNo,
    leadId: appointment.leadId,
    scheduledAt: appointment.scheduledAt,
    channel: appointment.channel,
    negotiatorEmployeeId: appointment.negotiatorEmployeeId,
    status: appointment.status as AppointmentStatus,
    rescheduledFromId: appointment.rescheduledFromId,
    remark: appointment.remark,
    createdBy: appointment.createdBy,
    createdAt: appointment.createdAt,
    updatedAt: appointment.updatedAt,
  };
}

function assertActiveAppointment(status: AppointmentStatus): void {
  if (!ACTIVE_APPOINTMENT_STATUSES.includes(status)) {
    throw new CrmError(
      LEAD_STATE_TRANSITION_INVALID,
      409,
      `appointment in ${status} cannot transition`,
    );
  }
}

function normalizeRequiredDateTime(value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return value;
}

// 分页归一化（同 lead-service/customer-service 文件本地助手纪律）。
function normalizePage(value: unknown): number {
  if (value === undefined) return 1;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return value;
}

function normalizePageSize(value: unknown): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return value;
}

function isUniqueConflictOn(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return text.includes(field);
}
