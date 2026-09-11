import { Prisma } from '@prisma/client';
import { GOVERNANCE_CODES, GovernanceError } from '../../../domain/admin-governance/governance-errors';
import { GovernedOperationType } from '../../../domain/admin-governance/governance-types';
import {
  setOrganizationStatusTx,
  setPositionStatusTx,
  setProfessionalTeamStatusTx,
  updateOrganizationTx,
  updatePositionTx,
  updateProfessionalTeamTx,
} from '../../master-data/transactional-master-data-commands';
import { MasterDataError } from '../../../domain/master-data/master-data-errors';
import {
  GovernedOperationAdapter,
  GovernanceExecutionOutcome,
  GovernanceExecutionRequest,
} from './governance-adapter';

type MasterDataOperationType = 'MASTER_DATA_STATUS_CORRECTION' | 'MASTER_DATA_METADATA_CORRECTION';
type MasterDataTargetType = 'ORGANIZATION' | 'POSITION' | 'PROFESSIONAL_TEAM';
type MasterDataStatus = 'ENABLED' | 'DISABLED';

const MASTER_DATA_OPERATIONS: ReadonlySet<GovernedOperationType> = new Set([
  'MASTER_DATA_STATUS_CORRECTION',
  'MASTER_DATA_METADATA_CORRECTION',
]);

export class MasterDataAdapter implements GovernedOperationAdapter {
  readonly key = 'master-data';

  supports(operationType: GovernedOperationType): boolean {
    return MASTER_DATA_OPERATIONS.has(operationType);
  }

  validatePayload(operationType: GovernedOperationType, payload: unknown): Prisma.InputJsonValue {
    const type = this.requireSupported(operationType);
    const input = exactObject(payload);
    if (type === 'MASTER_DATA_STATUS_CORRECTION') {
      if (Object.keys(input).length !== 1 || !Object.hasOwn(input, 'status')) targetIneligible();
      if (input.status !== 'ENABLED' && input.status !== 'DISABLED') targetIneligible();
      return { status: input.status };
    }

    const keys = Object.keys(input);
    if (keys.length !== 1) targetIneligible();
    const key = keys[0];
    if (key === 'sort') {
      if (typeof input.sort !== 'number' || !Number.isInteger(input.sort) || input.sort < 0) targetIneligible();
      return { sort: input.sort };
    }
    if (key === 'responsibilities' || key === 'description') {
      return { [key]: normalizeOptionalText(input[key]) };
    }
    targetIneligible();
  }

  async execute(
    tx: Prisma.TransactionClient,
    request: GovernanceExecutionRequest,
  ): Promise<GovernanceExecutionOutcome> {
    const operationType = this.requireSupported(request.operationType);
    const targetType = requireTargetType(request.targetType);
    const payload = this.validatePayload(operationType, request.payload) as Record<string, unknown>;
    const actor = { actorUserId: request.requesterUserId, requestId: request.operationId };

    if (operationType === 'MASTER_DATA_METADATA_CORRECTION') {
      if (targetType === 'ORGANIZATION' && Object.hasOwn(payload, 'sort')) {
        const before = await tx.organization.findUnique({ where: { id: request.targetId } });
        const after = await translateMasterDataErrors(updateOrganizationTx(tx, actor, request.targetId, {
          sort: payload.sort as number,
          version: request.expectedTargetVersion,
        }));
        return metadataOutcome(
          snapshot('ORGANIZATION', before && {
            id: before.id, sort: before.sort, status: before.status, version: before.version,
          }),
          snapshot('ORGANIZATION', after),
        );
      }
      if (targetType === 'POSITION' && Object.hasOwn(payload, 'responsibilities')) {
        const before = await tx.position.findUnique({ where: { id: request.targetId } });
        const after = await translateMasterDataErrors(updatePositionTx(tx, actor, request.targetId, {
          responsibilities: payload.responsibilities as string | null,
          version: request.expectedTargetVersion,
        }));
        return metadataOutcome(
          snapshot('POSITION', before && {
            id: before.id,
            responsibilities: before.responsibilities,
            status: before.status,
            version: before.version,
          }),
          snapshot('POSITION', after),
        );
      }
      if (targetType === 'PROFESSIONAL_TEAM' && Object.hasOwn(payload, 'description')) {
        const before = await tx.professionalTeam.findUnique({ where: { id: request.targetId } });
        const after = await translateMasterDataErrors(updateProfessionalTeamTx(tx, actor, request.targetId, {
          description: payload.description as string | null,
          version: request.expectedTargetVersion,
        }));
        return metadataOutcome(
          snapshot('PROFESSIONAL_TEAM', before && {
            id: before.id, description: before.description, status: before.status, version: before.version,
          }),
          snapshot('PROFESSIONAL_TEAM', after),
        );
      }
      targetIneligible();
    }

    const status = payload.status as MasterDataStatus;
    if (targetType === 'ORGANIZATION') {
      const before = await tx.organization.findUnique({ where: { id: request.targetId } });
      const after = await translateMasterDataErrors(setOrganizationStatusTx(
        tx, actor, request.targetId, status, request.expectedTargetVersion,
      ));
      return statusOutcome(
        snapshot('ORGANIZATION', before && {
          id: before.id, sort: before.sort, status: before.status, version: before.version,
        }),
        snapshot('ORGANIZATION', after),
      );
    }
    if (targetType === 'POSITION') {
      const before = await tx.position.findUnique({ where: { id: request.targetId } });
      const after = await translateMasterDataErrors(
        setPositionStatusTx(tx, actor, request.targetId, status, request.expectedTargetVersion),
      );
      return statusOutcome(
        snapshot('POSITION', before && {
          id: before.id,
          responsibilities: before.responsibilities,
          status: before.status,
          version: before.version,
        }),
        snapshot('POSITION', after),
      );
    }
    const before = await tx.professionalTeam.findUnique({ where: { id: request.targetId } });
    const after = await translateMasterDataErrors(setProfessionalTeamStatusTx(
      tx, actor, request.targetId, status, request.expectedTargetVersion,
    ));
    return statusOutcome(
      snapshot('PROFESSIONAL_TEAM', before && {
        id: before.id, description: before.description, status: before.status, version: before.version,
      }),
      snapshot('PROFESSIONAL_TEAM', after),
    );
  }

  private requireSupported(operationType: GovernedOperationType): MasterDataOperationType {
    if (!this.supports(operationType)) notAllowed();
    return operationType as MasterDataOperationType;
  }
}

function exactObject(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) targetIneligible();
  return payload as Record<string, unknown>;
}

function normalizeOptionalText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') targetIneligible();
  const normalized = value.trim();
  if (normalized.length > 2000) targetIneligible();
  return normalized.length === 0 ? null : normalized;
}

function requireTargetType(targetType: string): MasterDataTargetType {
  if (targetType !== 'ORGANIZATION' && targetType !== 'POSITION' && targetType !== 'PROFESSIONAL_TEAM') {
    targetIneligible();
  }
  return targetType;
}

function snapshot(
  targetType: MasterDataTargetType,
  value: object | null,
): Prisma.InputJsonValue {
  return value === null ? { targetType, state: 'MISSING' } : { targetType, ...value } as Prisma.InputJsonValue;
}

function metadataOutcome(
  beforeSnapshot: Prisma.InputJsonValue,
  afterSnapshot: Prisma.InputJsonValue,
): GovernanceExecutionOutcome {
  return { beforeSnapshot, afterSnapshot, resultCode: 'MASTER_DATA_METADATA_CORRECTED' };
}

function statusOutcome(
  beforeSnapshot: Prisma.InputJsonValue,
  afterSnapshot: Prisma.InputJsonValue,
): GovernanceExecutionOutcome {
  return { beforeSnapshot, afterSnapshot, resultCode: 'MASTER_DATA_STATUS_CORRECTED' };
}

function notAllowed(): never {
  throw new GovernanceError(GOVERNANCE_CODES.notAllowed, 403);
}

function targetIneligible(): never {
  throw new GovernanceError(GOVERNANCE_CODES.targetIneligible, 422);
}

async function translateMasterDataErrors<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof MasterDataError && error.code === 'VERSION_CONFLICT') {
      throw new GovernanceError(GOVERNANCE_CODES.staleTarget, 409);
    }
    throw error;
  }
}
