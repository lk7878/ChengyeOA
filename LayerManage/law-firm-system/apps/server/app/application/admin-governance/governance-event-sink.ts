import {
  GovernedOperationType,
  GovernanceRisk,
  GovernanceStatus,
} from '../../domain/admin-governance/governance-types';

export interface GovernanceEvent {
  eventType: string;
  operationId: string;
  operationType: GovernedOperationType;
  riskLevel: GovernanceRisk;
  status: GovernanceStatus;
  resultCode: string;
  requestId: string;
}

export interface GovernanceEventSink {
  /** Test-only observation hook. Public domain events must be persisted through EventOutboxWriter. */
  emit(event: GovernanceEvent): void | Promise<void>;
}

export class NoopGovernanceEventSink implements GovernanceEventSink {
  emit(): void {}
}

export class InMemoryGovernanceEventSink implements GovernanceEventSink {
  readonly events: GovernanceEvent[] = [];

  emit(event: GovernanceEvent): void {
    this.events.push({ ...event });
  }
}
