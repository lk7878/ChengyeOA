import { AdminOperation, Prisma, PrismaClient } from '@prisma/client';
import { hashPayload } from '../../domain/admin-governance/canonical-json';
import { GOVERNANCE_CODES, GovernanceError } from '../../domain/admin-governance/governance-errors';
import { GOVERNED_OPERATION_CATALOG } from '../../domain/admin-governance/operation-catalog';
import { GovernedOperationType, GovernanceRequesterRole, GovernanceRisk, GovernanceStatus } from '../../domain/admin-governance/governance-types';
import { parseCancelGovernanceInput, parseCreateGovernanceInput } from '../../domain/admin-governance/governance-validation';
import { AuthorizationContext } from '../authorization/authorization-service';
import { writeAuditLog } from '../system/audit-writer';
import { GovernedOperationAdapter } from './adapters/governance-adapter';
import { GovernanceEventSink } from './governance-event-sink';
import { GovernanceExecutionRunner } from './governance-execution-runner';
import { GovernanceStore } from './governance-store';
import { AdminOperationDetailView, toAdminOperationDetailView } from './governance-views';
import {
  consumeGovernanceStepUp,
  GovernanceStepUpAuthorization,
  GovernanceStepUpConsumer,
  requiresGovernanceStepUp,
} from './governance-step-up';

export class GovernanceCommandService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly runner: GovernanceExecutionRunner,
    private readonly adapters: readonly GovernedOperationAdapter[],
    private readonly databaseName: string,
    private readonly eventSink: GovernanceEventSink,
    private readonly stepUp: GovernanceStepUpConsumer,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async create(
    context: AuthorizationContext,
    raw: unknown,
    requestId?: string,
    stepUpAuthorization?: GovernanceStepUpAuthorization,
  ): Promise<AdminOperationDetailView> {
    requirePermission(context, 'governance.operation.create');
    const input = parseCreateGovernanceInput(raw);
    const catalog = GOVERNED_OPERATION_CATALOG[input.operationType];
    const requesterRole = roleFor(context);
    if (!requesterRole || !catalog.requesterRoles.includes(requesterRole)) notAllowed();
    const adapter = this.adapters.find(item => item.key === catalog.adapterKey && item.supports(input.operationType));
    if (!adapter) notAllowed();
    const normalizedPayload = adapter.validatePayload(input.operationType, input.payload);
    const payloadHash = hashPayload(normalizedPayload);
    const confirmationAt = await this.validateCriticalConfirmation(input.operationType, input.targetId, input.confirmation);

    const existing = await new GovernanceStore(this.prisma).findByRequesterIdempotency(
      context.userId,
      input.idempotencyKey,
    );
    if (existing) return this.idempotentResult(existing, input, payloadHash);

    let created: AdminOperation;
    try {
      created = await this.prisma.$transaction(async tx => {
        if (requiresGovernanceStepUp(catalog.riskLevel)) {
          await consumeGovernanceStepUp(
            tx,
            this.stepUp,
            context.userId,
            stepUpAuthorization,
            'ADMIN_GOVERNANCE_CREATE',
            {
              operationType: input.operationType,
              targetType: input.targetType,
              targetId: input.targetId,
              expectedTargetVersion: input.expectedTargetVersion,
              payloadHash,
            },
          );
        }
        const operation = await new GovernanceStore(tx).create({
          operationType: input.operationType,
          riskLevel: catalog.riskLevel,
          reviewMode: catalog.reviewMode,
          status: catalog.reviewMode === 'PRE' ? 'PENDING_REVIEW' : 'EXECUTING',
          requesterUserId: context.userId,
          targetType: input.targetType,
          targetId: input.targetId,
          reason: input.reason,
          payloadSnapshot: normalizedPayload,
          payloadHash,
          expectedTargetVersion: input.expectedTargetVersion,
          idempotencyKey: input.idempotencyKey,
          secondConfirmationAt: confirmationAt,
        });
        await writeAuditLog(tx, {
          userId: context.userId,
          action: confirmationAt ? 'ADMIN_GOVERNANCE_CREATED_CONFIRMED' : 'ADMIN_GOVERNANCE_CREATED',
          targetType: 'ADMIN_GOVERNANCE',
          targetId: operation.id,
          newValues: JSON.stringify({
            operationType: operation.operationType,
            riskLevel: operation.riskLevel,
            status: operation.status,
          }),
        });
        return operation;
      });
    } catch (error) {
      if (error instanceof GovernanceError && error.code === GOVERNANCE_CODES.idempotency) {
        const raced = await new GovernanceStore(this.prisma).findByRequesterIdempotency(
          context.userId,
          input.idempotencyKey,
        );
        if (raced) return this.idempotentResult(raced, input, payloadHash);
      }
      throw error;
    }

    const eventRequestId = requestId ?? created.id;
    await this.eventSink.emit(eventFor(created, 'OPERATION_CREATED', created.status as GovernanceStatus, 'CREATED', eventRequestId));
    if (catalog.reviewMode === 'POST') {
      return this.runner.execute(created.id, created.version, eventRequestId, true);
    }
    return this.detail(created.id);
  }

  async cancel(
    context: AuthorizationContext,
    id: string,
    raw: unknown,
    requestId = id,
  ): Promise<AdminOperationDetailView> {
    const input = parseCancelGovernanceInput(raw);
    const cancelled = await this.prisma.$transaction(async tx => {
      await lockOperation(tx, id);
      const operation = await tx.adminOperation.findUnique({ where: { id } });
      if (!operation || operation.requesterUserId !== context.userId) hidden();
      if (operation.status !== 'PENDING_REVIEW' || operation.version !== input.expectedOperationVersion) processed();
      const next = await new GovernanceStore(tx).transition(id, 'PENDING_REVIEW', operation.version, 'CANCELLED');
      await writeAuditLog(tx, {
        userId: context.userId,
        action: 'ADMIN_GOVERNANCE_CANCELLED',
        targetType: 'ADMIN_GOVERNANCE',
        targetId: id,
      });
      return next;
    });
    await this.eventSink.emit(eventFor(cancelled, 'OPERATION_CANCELLED', 'CANCELLED', 'CANCELLED', requestId));
    return this.detail(id);
  }

  private async validateCriticalConfirmation(
    operationType: GovernedOperationType,
    targetId: string,
    confirmation?: string,
  ): Promise<Date | null> {
    const template = GOVERNED_OPERATION_CATALOG[operationType].confirmationTemplate;
    if (!template) return null;
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { username: true } });
    if (!target) targetIneligible();
    const exact = template
      .replaceAll('{databaseName}', this.databaseName)
      .replaceAll('{operationType}', operationType)
      .replaceAll('{targetUsername}', target.username);
    if (confirmation !== exact) targetIneligible();
    return this.clock();
  }

  private async idempotentResult(
    existing: AdminOperation,
    input: ReturnType<typeof parseCreateGovernanceInput>,
    payloadHash: string,
  ): Promise<AdminOperationDetailView> {
    const catalog = GOVERNED_OPERATION_CATALOG[input.operationType];
    const identical = existing.operationType === input.operationType
      && existing.riskLevel === catalog.riskLevel
      && existing.reviewMode === catalog.reviewMode
      && existing.targetType === input.targetType
      && existing.targetId === input.targetId
      && existing.reason === input.reason
      && existing.payloadHash === payloadHash
      && existing.expectedTargetVersion === input.expectedTargetVersion;
    if (!identical) throw new GovernanceError(GOVERNANCE_CODES.idempotency, 409);
    return this.detail(existing.id);
  }

  private async detail(id: string): Promise<AdminOperationDetailView> {
    const operation = await new GovernanceStore(this.prisma).getDetail(id);
    if (!operation) hidden();
    return toAdminOperationDetailView(operation);
  }
}

function roleFor(context: AuthorizationContext): GovernanceRequesterRole | null {
  if (context.isSystemSuperAdmin) return 'SYSTEM_SUPER_ADMIN';
  if (context.isSystemAdmin) return 'SYSTEM_ADMIN';
  return null;
}

function requirePermission(context: AuthorizationContext, permission: 'governance.operation.create'): void {
  if (!context.permissionCodes.includes(permission)) notAllowed();
}

async function lockOperation(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "admin_operation" WHERE "id" = ${id} FOR UPDATE`);
}

function eventFor(operation: AdminOperation, eventType: string, status: GovernanceStatus, resultCode: string, requestId: string) {
  return {
    eventType,
    operationId: operation.id,
    operationType: operation.operationType as GovernedOperationType,
    riskLevel: operation.riskLevel as GovernanceRisk,
    status,
    resultCode,
    requestId,
  };
}

function notAllowed(): never { throw new GovernanceError(GOVERNANCE_CODES.notAllowed, 403); }
function targetIneligible(): never { throw new GovernanceError(GOVERNANCE_CODES.targetIneligible, 422); }
function hidden(): never { throw new GovernanceError(GOVERNANCE_CODES.hidden, 404); }
function processed(): never { throw new GovernanceError(GOVERNANCE_CODES.processed, 409); }
