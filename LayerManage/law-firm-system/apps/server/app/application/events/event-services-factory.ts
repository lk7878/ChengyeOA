import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import type {
  ApprovalTimeoutEnvironment,
  EventObservabilityEnvironment,
  EventWorkerEnvironment,
  LeadRecycleEnvironment,
} from '../../../config/env';
import { parseEventPayload } from '../../domain/events/event-registry';
import { AdminOperationReviewedV1, LeadAssignedV1 } from '../../domain/events/event-types';
import { ApprovalTimeoutScanner } from '../approval/approval-timeout-scanner';
import { LeadRecycleScanner } from '../crm/lead-recycle-scanner';
import { EventDeliveryStore } from './event-delivery-store';
import { EventDispatcher } from './event-dispatcher';
import { EventHandlerRegistry } from './event-handler-registry';
import { EventHealthService } from './event-health-service';
import { PrismaEventOutboxWriter } from './event-outbox-writer';
import { EventRuntimeSnapshotReader } from './event-runtime-snapshot-reader';
import { EventWorker } from './event-worker';
import { EventWorkerRuntimeStatusStore } from './event-worker-runtime-status-store';
import {
  AdminOperationReviewedNotificationHandler,
  ADMIN_OPERATION_REVIEWED_NOTIFICATION_HANDLER_CODE,
} from './handlers/admin-operation-reviewed-notification-handler';
import {
  LeadFirstResponseHandler,
  LEAD_FIRST_RESPONSE_MONITOR_HANDLER_CODE,
} from './handlers/lead-first-response-handler';

export interface EventServices {
  readonly registry: EventHandlerRegistry;
  readonly dispatcher: EventDispatcher;
  readonly deliveryStore: EventDeliveryStore;
  readonly worker: EventWorker;
  readonly health: EventHealthService;
  readonly outboxWriter: PrismaEventOutboxWriter;
  readonly runtimeStatus: EventWorkerRuntimeStatusStore;
  readonly snapshotReader: EventRuntimeSnapshotReader;
}

export interface EventServicesFactoryOptions {
  readonly workerId?: string;
  readonly observability?: EventObservabilityEnvironment;
  /**
   * SPEC-009 Task 9：首响超时回收配置。存在时构造 LeadRecycleScanner 并将其
   * scanOnce（绑定后丢弃计数）作为 worker 的 tickListener；缺省时本 worker 不带
   * listener。全部三调用点（app.ts 启动钩子、controller/eventOperations.ts、
   * governance-factory.ts）均同源注入 app.config.leadRecycle（终审修复轮前曾仅
   * 启动钩子注入，I-1 根治后两处调用点已补齐）。签名归一化（同 DEFAULT_OBSERVABILITY 先例）：
   * 缺省在 configurationSignature 中按默认值 { enabled: true, noFollowHours: 24 }
   * 参与比较——默认环境变量下启动钩子与后续调用方共享同一服务图（缓存命中，
   * 启动钩子先初始化，worker 带 scanner）；显式传入非默认值与缺省调用混用时
   * 签名不一致 fail-fast（配置冲突宁可响爆也不静默分叉）。
   */
  readonly leadRecycle?: LeadRecycleEnvironment;
  /**
   * SPEC-021 Task 1：审批超时升级扫描配置。存在时构造 ApprovalTimeoutScanner 并将其
   * scanOnce（绑定后丢弃计数）作为 worker tick 的旁挂 listener（沿 SPEC-009
   * LeadRecycleScanner 注入点）；缺省时本 worker 不带审批超时扫描器。签名归一化：
   * 缺省按默认值 { timeoutHours: 72 } 参与比较（与 leadRecycle 同型语义），
   * 显式非默认值与缺省调用混用时签名不一致 fail-fast（配置冲突宁可响爆也不静默分叉）。
   */
  readonly approvalTimeout?: ApprovalTimeoutEnvironment;
}

interface CachedEventServices {
  readonly signature: string;
  readonly services: EventServices;
}

const servicesByClient = new WeakMap<PrismaClient, CachedEventServices>();
const DEFAULT_OBSERVABILITY: EventObservabilityEnvironment = Object.freeze({
  heartbeatSeconds: 10,
  heartbeatStaleSeconds: 60,
  undispatchedBlockSeconds: 120,
  dueBacklogBlockSeconds: 300,
  leaseLostDegradedCount: 1,
  leaseLostBlockedCount: 3,
  canaryWindowMinutes: 15,
});
// 与 config/env.ts parseLeadRecycleEnvironment 的缺省一致；仅用于签名归一化（见上）。
const DEFAULT_LEAD_RECYCLE: LeadRecycleEnvironment = Object.freeze({
  enabled: true,
  noFollowHours: 24,
});
// 与 config/env.ts parseApprovalTimeoutEnvironment 的缺省一致；仅用于签名归一化（见上）。
const DEFAULT_APPROVAL_TIMEOUT: ApprovalTimeoutEnvironment = Object.freeze({
  timeoutHours: 72,
});

export function createEventServices(
  prisma: PrismaClient,
  config: EventWorkerEnvironment,
  options: EventServicesFactoryOptions = {},
): EventServices {
  const observability = options.observability ?? DEFAULT_OBSERVABILITY;
  const signature = configurationSignature(config, observability, options);
  const existing = servicesByClient.get(prisma);
  if (existing) {
    if (existing.signature !== signature) {
      throw new Error('Event services already initialized with different configuration');
    }
    return existing.services;
  }

  validateConfiguration(config);
  const registry = new EventHandlerRegistry();
  registry.register({
    handlerCode: ADMIN_OPERATION_REVIEWED_NOTIFICATION_HANDLER_CODE,
    eventType: 'admin.operation.reviewed',
    eventVersion: 1,
    handler: new AdminOperationReviewedNotificationHandler(),
    safeSummary: payload => {
      const parsed = parseEventPayload<AdminOperationReviewedV1>('admin.operation.reviewed', 1, payload).payload;
      return {
        operationId: parsed.operationId,
        operationType: parsed.operationType,
        riskLevel: parsed.riskLevel,
        status: parsed.status,
      };
    },
  });
  registry.register({
    handlerCode: LEAD_FIRST_RESPONSE_MONITOR_HANDLER_CODE,
    eventType: 'lead.assigned',
    eventVersion: 1,
    handler: new LeadFirstResponseHandler(),
    safeSummary: payload => {
      const parsed = parseEventPayload<LeadAssignedV1>('lead.assigned', 1, payload).payload;
      return {
        leadId: parsed.leadId,
        action: parsed.action,
      };
    },
  });
  registry.validate();
  const health = new EventHealthService(config.enabled);
  const dispatcher = new EventDispatcher(prisma, registry, health);
  const deliveryStore = new EventDeliveryStore(prisma, { leaseSeconds: config.leaseSeconds });
  const outboxWriter = new PrismaEventOutboxWriter();
  const runtimeStatus = new EventWorkerRuntimeStatusStore(prisma, {
    heartbeatSeconds: observability.heartbeatSeconds,
  });
  const snapshotReader = new EventRuntimeSnapshotReader(prisma, {
    leaseSeconds: config.leaseSeconds,
    runtimeStatus,
  });
  const leadRecycleScanner = options.leadRecycle
    ? new LeadRecycleScanner(prisma, options.leadRecycle, outboxWriter)
    : undefined;
  const approvalTimeoutScanner = options.approvalTimeout
    ? new ApprovalTimeoutScanner(prisma, {
        timeoutHours: options.approvalTimeout.timeoutHours,
        dedupPrefix: 'approval-timeout',
        batchSize: 100,
      })
    : undefined;
  const tickListeners: Array<{ label: string; run: (now: Date) => Promise<void> }> = [];
  if (leadRecycleScanner) {
    // scanOnce 返回回收条数；worker 的 listener 契约只关心完成/抛错，包一层丢弃计数。
    tickListeners.push({ label: 'lead-recycle-scanner', run: async now => { await leadRecycleScanner.scanOnce(now); } });
  }
  if (approvalTimeoutScanner) {
    tickListeners.push({ label: 'approval-timeout-scanner', run: async now => { await approvalTimeoutScanner.scanOnce(now); } });
  }
  const worker = new EventWorker({
    prisma,
    dispatcher,
    deliveryStore,
    registry,
    health,
    workerId: options.workerId ?? `event-worker-${randomUUID()}`,
    config: {
      pollMs: config.pollMs,
      batchSize: config.batchSize,
      leaseSeconds: config.leaseSeconds,
    },
    runtimeStatus,
    // 多扫描器各自 try/catch 隔离：单个扫描器抛错仅记日志，不影响其余扫描器与投递循环。
    tickListener: tickListeners.length > 0
      ? async (now: Date): Promise<void> => {
          for (const listener of tickListeners) {
            try {
              await listener.run(now);
            } catch (error) {
              console.error(
                '[%s] tick listener failed: %s',
                listener.label,
                error instanceof Error ? error.message : String(error),
              );
            }
          }
        }
      : undefined,
  });
  const services = Object.freeze({
    registry,
    dispatcher,
    deliveryStore,
    worker,
    health,
    outboxWriter,
    runtimeStatus,
    snapshotReader,
  });
  servicesByClient.set(prisma, { signature, services });
  return services;
}

function configurationSignature(
  config: EventWorkerEnvironment,
  observability: EventObservabilityEnvironment,
  options: EventServicesFactoryOptions,
): string {
  return [
    config.enabled ? 'enabled' : 'disabled',
    config.pollMs,
    config.batchSize,
    config.leaseSeconds,
    config.shutdownSeconds,
    observability.heartbeatSeconds,
    observability.heartbeatStaleSeconds,
    observability.undispatchedBlockSeconds,
    observability.dueBacklogBlockSeconds,
    observability.leaseLostDegradedCount,
    observability.leaseLostBlockedCount,
    observability.canaryWindowMinutes,
    JSON.stringify(options.workerId === undefined
      ? { kind: 'generated' }
      : { kind: 'explicit', value: options.workerId }),
    // 缺省按默认值归一化（DEFAULT_OBSERVABILITY 先例）：默认环境下不传 leadRecycle 的
    // 调用方与启动钩子共享缓存图；显式非默认值与缺省混用则签名不一致 fail-fast。
    JSON.stringify(options.leadRecycle ?? DEFAULT_LEAD_RECYCLE),
    // SPEC-021 Task 1：approvalTimeout 同型归一化（缺省按 72 参与比较，防默认/显式混用分叉）。
    JSON.stringify(options.approvalTimeout ?? DEFAULT_APPROVAL_TIMEOUT),
  ].join(':');
}

function validateConfiguration(config: EventWorkerEnvironment): void {
  assertIntegerRange(config.pollMs, 250, 60_000, 'Event worker poll milliseconds');
  assertIntegerRange(config.batchSize, 1, 200, 'Event worker batch size');
  assertIntegerRange(config.leaseSeconds, 30, 600, 'Event worker lease seconds');
  assertIntegerRange(config.shutdownSeconds, 1, 120, 'Event worker shutdown seconds');
  if (config.shutdownSeconds >= config.leaseSeconds) {
    throw new RangeError('Event worker shutdown seconds must be less than lease seconds');
  }
  if (typeof config.enabled !== 'boolean') throw new TypeError('Event worker enabled must be boolean');
}

function assertIntegerRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be between ${minimum} and ${maximum}`);
  }
}
