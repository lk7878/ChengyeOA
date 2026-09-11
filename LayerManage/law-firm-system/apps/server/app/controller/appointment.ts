// SPEC-009 Task 10: appointment HTTP 控制器（新建）。
// 薄控制器纪律同 lead.ts：传输层解析（ISO 日期）→ 调冻结服务 → 包络响应；
// 服务抛错原样传播给 errorHandler。
// 路由面（R-10a/R-10f）：create/visit/reschedule/show + 嵌套 GET /api/v1/leads/:id/appointments
// （挂在 lead 控制器 appointments()）；markNoShow/cancel 服务方法存在但 brief 未要求路由，
// 刻意不暴露；顶层 GET /api/v1/appointments 日历范围查询经 2026-07-29 用户裁定开放
// （VisitCalendarPage 跨线索查询，服务层 listAppointmentsByRange 纯追加）。

import { Controller } from 'egg';

import { appointmentService } from '../application/crm/crm-factory';
import { AppointmentChannel, AppointmentRangeQuery } from '../application/crm/appointment-service';
import { MasterDataError } from '../domain/master-data/master-data-errors';
import { assertExactKeys, parseIsoDate } from '../domain/master-data/master-data-validation';

export default class AppointmentController extends Controller {
  /** GET /api/v1/appointments（appointment.read，2026-07-29 裁定：到访日历范围查询）。 */
  async index() {
    this.respond(await appointmentService(this.ctx).listAppointmentsByRange(parseRangeQuery(this.ctx.query)));
  }

  /** POST /api/v1/appointments（appointment.create）：body 携带 leadId + 槽位。 */
  async create() {
    const body = this.ctx.request.body;
    assertExactKeys(body, ['leadId', 'scheduledAt', 'channel', 'negotiatorEmployeeId', 'remark']);
    this.respond(await appointmentService(this.ctx).createAppointment(body.leadId as string, {
      scheduledAt: parseIsoDate(body.scheduledAt),
      channel: body.channel as AppointmentChannel,
      negotiatorEmployeeId: body.negotiatorEmployeeId as string | undefined,
      remark: body.remark as string | undefined,
    }));
  }

  /** POST /api/v1/appointments/:id/visit（appointment.visit）：确认到访。 */
  async visit() {
    this.respond(await appointmentService(this.ctx).confirmVisit(this.ctx.params.id));
  }

  /** POST /api/v1/appointments/:id/reschedule（appointment.create）：改期。 */
  async reschedule() {
    const body = this.ctx.request.body;
    assertExactKeys(body, ['scheduledAt']);
    this.respond(await appointmentService(this.ctx).reschedule(
      this.ctx.params.id,
      parseIsoDate(body.scheduledAt),
    ));
  }

  /** GET /api/v1/appointments/:id（appointment.read）。 */
  async show() {
    this.respond(await appointmentService(this.ctx).getAppointment(this.ctx.params.id));
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

/** 日历范围 query 解析（同 lead.ts parseLeadListQuery 纪律）：ISO 日期 + 数字页码，非法形态 400。 */
function parseRangeQuery(input: unknown): AppointmentRangeQuery {
  assertExactKeys(input, ['from', 'to', 'page', 'pageSize']);
  const query: AppointmentRangeQuery = {
    from: parseIsoDate(input.from),
    to: parseIsoDate(input.to),
  };
  if (input.page !== undefined) query.page = parseQueryInteger(input.page);
  if (input.pageSize !== undefined) query.pageSize = parseQueryInteger(input.pageSize);
  return query;
}

/** query 数字解析：非法形态 400（服务层 normalizePage 只接受 number，传输层先行把关）。 */
function parseQueryInteger(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return Number(value);
}
