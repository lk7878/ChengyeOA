import { SopTemplateAdapter } from './adapters/sop-template-adapter';
import { PrismaClient } from '@prisma/client';
import { Context } from 'egg';
import { AdministratorAccountAdapter } from './adapters/administrator-account-adapter';
import { GovernedOperationAdapter } from './adapters/governance-adapter';
import { MasterDataAdapter } from './adapters/master-data-adapter';
import { GovernanceCommandService } from './governance-command-service';
import { GovernanceEventSink, NoopGovernanceEventSink } from './governance-event-sink';
import { GovernanceExecutionRunner } from './governance-execution-runner';
import { GovernanceQueryService } from './governance-query-service';
import { GovernanceReviewService } from './governance-review-service';
import { createAuthenticationServices } from '../auth/authentication-factory';
import { GovernanceStepUpConsumer } from './governance-step-up';
import { EventOutboxWriter, PrismaEventOutboxWriter } from '../events/event-outbox-writer';
import { createEventServices } from '../events/event-services-factory';

export interface GovernanceFactoryOptions {
  databaseName: string;
  eventSink?: GovernanceEventSink;
  outboxWriter?: EventOutboxWriter;
  clock?: () => Date;
  adapters?: readonly GovernedOperationAdapter[];
  stepUp: GovernanceStepUpConsumer;
}

export function createGovernanceServices(prisma: PrismaClient, options: GovernanceFactoryOptions) {
  const eventSink = options.eventSink ?? new NoopGovernanceEventSink();
  const outboxWriter = options.outboxWriter ?? new PrismaEventOutboxWriter();
  const clock = options.clock ?? (() => new Date());
  const adapters = options.adapters ?? [
    new AdministratorAccountAdapter(clock),
    new MasterDataAdapter(),
    new SopTemplateAdapter(),
  ];
  const runner = new GovernanceExecutionRunner(prisma, adapters, eventSink, options.stepUp, clock);
  return {
    command: new GovernanceCommandService(
      prisma,
      runner,
      adapters,
      options.databaseName,
      eventSink,
      options.stepUp,
      clock,
    ),
    review: new GovernanceReviewService(prisma, runner, eventSink, options.stepUp, outboxWriter, clock),
    query: new GovernanceQueryService(prisma, options.databaseName),
    runner,
  };
}

export function createGovernanceServicesForContext(ctx: Context) {
  const databaseName = databaseNameFromUrl(process.env.DATABASE_URL);
  // SPEC-009 Task 10（R-10g/I-1 根治 + 终审条目 18）：与 app.ts:39-42 启动钩子
  // 签名逐字一致——observability/leadRecycle 双全（eventOperations.ts:45-50 同形），
  // 非默认 EVENT_OBSERVABILITY_*/LEAD_RECYCLE_* 环境下缺省任一项都会触发服务签名不一致 fail-fast。
  const eventServices = createEventServices(ctx.prisma, ctx.app.config.eventWorker, {
    observability: ctx.app.config.eventObservability,
    leadRecycle: ctx.app.config.leadRecycle,
    // SPEC-021 Task 2：审批超时扫描器随事件 worker tick 节律运行（同源注入，沿 leadRecycle）。
    approvalTimeout: ctx.app.config.approvalTimeout,
  });
  return createGovernanceServices(ctx.prisma, {
    databaseName,
    stepUp: createAuthenticationServices(ctx).stepUp,
    outboxWriter: eventServices.outboxWriter,
  });
}

export function databaseNameFromUrl(raw: string | undefined): string {
  try {
    if (!raw) throw new Error('missing database URL');
    const url = new URL(raw);
    if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error('invalid protocol');
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (!databaseName) throw new Error('missing database name');
    return databaseName;
  } catch {
    throw new Error('Governance database configuration is invalid');
  }
}
