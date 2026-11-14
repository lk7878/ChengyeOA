import { Prisma } from '@prisma/client';

import { PermanentEventError } from '../../../domain/events/event-errors';
import { parseEventPayload } from '../../../domain/events/event-registry';
import { LeadAssignedV1 } from '../../../domain/events/event-types';
import { EventHandler, EventHandlerContext } from '../event-delivery-store';

export const LEAD_FIRST_RESPONSE_MONITOR_HANDLER_CODE = 'LEAD_FIRST_RESPONSE_MONITOR';
const EVENT_TYPE = 'lead.assigned';
const EVENT_VERSION = 1;

/**
 * SPEC-009 Task 9 首响 pilot handler（R-3 裁定：最小消费）。
 * 订阅 lead.assigned v1，仅验证「订阅-投递管线连通」：按参考 handler
 * （admin-operation-reviewed-notification-handler）的解析纪律校验信封与负载——
 * parseEventPayload 严格四键 + handlerCode/eventType/eventVersion/orderingKey 一致性，
 * 任何不匹配 → PermanentEventError(LEAD_FIRST_RESPONSE_SOURCE_INVALID)（安全永久错误，
 * 进入 MANUAL 证据而非重试）。
 * **刻意不做**：不写业务表、不做超时回收、不写 Notification。首响超时检查由独立的
 * LeadRecycleScanner 周期扫描单元承担（候选 A，与本 handler 完全隔离，设计 §6.5）；
 * 回收即最强提醒（线索离手），首响超时提醒主管的完整通知能力下推通知中心 SPEC（非目标 7）。
 */
export class LeadFirstResponseHandler implements EventHandler {
  async handle(_tx: Prisma.TransactionClient, context: EventHandlerContext): Promise<void> {
    parsePayload(context);
    // pilot：正常消费即完成，投递记 SUCCEEDED；无任何副作用。
  }
}

function parsePayload(context: EventHandlerContext): LeadAssignedV1 {
  try {
    const parsed = parseEventPayload<LeadAssignedV1>(context.eventType, context.eventVersion, context.payload);
    if (context.handlerCode !== LEAD_FIRST_RESPONSE_MONITOR_HANDLER_CODE
      || context.eventType !== EVENT_TYPE
      || context.eventVersion !== EVENT_VERSION
      || context.orderingKey !== parsed.orderingKey) {
      sourceInvalid();
    }
    return parsed.payload;
  } catch (error) {
    if (error instanceof PermanentEventError) throw error;
    sourceInvalid();
  }
}

function sourceInvalid(): never {
  throw new PermanentEventError('LEAD_FIRST_RESPONSE_SOURCE_INVALID');
}
