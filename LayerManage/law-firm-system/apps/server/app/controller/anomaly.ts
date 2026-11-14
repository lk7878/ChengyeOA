// SPEC-011 Task 10: anomaly HTTP 控制器（FIN-05 四口径异常台账，纯只读）。
// 薄控制器纪律（逐字仿 SPEC-010 T10 payment.ts）：传输层解析 → 调 Task 9 冻结服务 →
// 包络响应。四端点嵌套路径 /api/v1/finance/anomalies/* 均挂 anomaly.read 权限码；
// 查询白名单仅 ['page','pageSize']。零事务/零事件/零审计（纯读路径，服务层纪律）。

import { Controller } from 'egg';

import { anomalyService } from '../application/finance/finance-factory';
import { AnomalyListQuery } from '../application/finance/finance-types';
import { MasterDataError } from '../domain/master-data/master-data-errors';
import { assertExactKeys } from '../domain/master-data/master-data-validation';

const LIST_QUERY_KEYS = ['page', 'pageSize'] as const;

export default class AnomalyController extends Controller {
  /** GET /api/v1/finance/anomalies/signed-unpaid（anomaly.read）：SIGNED/EFFECTIVE 且分文未收。 */
  async signedUnpaid() {
    this.respond(await anomalyService(this.ctx).listSignedUnpaid(parseAnomalyListQuery(this.ctx.query)));
  }

  /**
   * GET /api/v1/finance/anomalies/received-uninvoiced（anomaly.read）：已收但 COMPLETED
   * 发票累计 < receivedAmount。
   * ⚠️① Task 9 文档化（分页语义）：total = 候选池规模（scope + receivedAmount>0 + 未删），
   * list = 当页过滤后子集（页级发票聚合在内存过滤——页内条数可 < pageSize）。前端分页渲染
   * 按此语义（total 为候选池、list 为当页命中），不按"过滤后全量"推导。
   */
  async receivedUninvoiced() {
    this.respond(await anomalyService(this.ctx).listReceivedUninvoiced(parseAnomalyListQuery(this.ctx.query)));
  }

  /** GET /api/v1/finance/anomalies/first-sign-no-formal（anomaly.read）：首签且同客户无 FORMAL。 */
  async firstSignNoFormal() {
    this.respond(await anomalyService(this.ctx).listFirstSignNoFormal(parseAnomalyListQuery(this.ctx.query)));
  }

  /** GET /api/v1/finance/anomalies/paid-no-case（anomaly.read）：已收 FORMAL 且未关联案件。 */
  async paidNoCase() {
    this.respond(await anomalyService(this.ctx).listPaidNoCase(parseAnomalyListQuery(this.ctx.query)));
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

function parseAnomalyListQuery(input: unknown): AnomalyListQuery {
  assertExactKeys(input, LIST_QUERY_KEYS);
  const query: AnomalyListQuery = {};
  if (input.page !== undefined) query.page = parseQueryInteger(input.page);
  if (input.pageSize !== undefined) query.pageSize = parseQueryInteger(input.pageSize);
  return query;
}

/** query 数字解析：非法形态 400（与 payment/lead/customer 控制器同一纪律）。 */
function parseQueryInteger(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return Number(value);
}
