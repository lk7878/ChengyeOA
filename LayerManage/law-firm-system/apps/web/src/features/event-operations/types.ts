export type EventDeliveryStatus = 'PENDING' | 'RETRY_WAIT' | 'PROCESSING' | 'MANUAL' | 'SUCCEEDED';
export type EventDeliverySortKey = 'createdAt' | 'updatedAt' | 'nextAttemptAt' | 'status';
export type SortOrder = 'asc' | 'desc';

export interface EventEnvelopeSummary {
  id: string;
  eventType: string;
  eventVersion: number;
  sourceModule: string;
  objectType: string;
  objectId: string;
  traceId: string;
  occurredAt: string;
  createdAt: string;
}

export interface EventDeliverySummary {
  id: string;
  status: EventDeliveryStatus;
  handlerCode: string;
  internal: boolean;
  attemptCount: number;
  manualRetryCount: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  lastErrorReference: string | null;
  version: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  event: EventEnvelopeSummary;
}

export interface EventDeliveryAttempt {
  attemptNumber: number;
  outcome: 'SUCCEEDED' | 'RETRY_SCHEDULED' | 'MANUAL_REQUIRED' | 'LEASE_LOST';
  errorCode: string | null;
  errorReference: string | null;
  durationMs: number;
  startedAt: string;
  completedAt: string;
}

export interface EventDeliveryDetail extends EventDeliverySummary {
  payloadSummary: Readonly<Record<string, string | number | boolean | null>>;
  attemptsTotal: number;
  attemptsTruncated: boolean;
  attempts: EventDeliveryAttempt[];
}

export interface EventWorkerSummary {
  status: 'healthy' | 'degraded';
  workerEnabled: boolean;
  lastSuccessfulTickAt: string | null;
  lastDatabaseFailureAt: string | null;
  consecutiveDatabaseFailures: number;
  databaseFailureTotal: number;
  unknownHandlerCount: number;
  invalidFilterCount: number;
  invalidEnvelopeCount: number;
  unresolvedDispatcherFaultCount: number;
  lastDegradedAt: string | null;
  lastErrorCode:
    | 'HANDLER_NOT_REGISTERED'
    | 'SUBSCRIPTION_FILTER_INVALID'
    | 'EVENT_ENVELOPE_INVALID'
    | 'EVENT_WORKER_DATABASE_FAILURE'
    | null;
  lastErrorReference: string | null;
}

export type EventRolloutStatus = 'READY' | 'DEGRADED' | 'BLOCKED';

export interface EventObservabilityMetrics {
  undispatchedCount: number;
  oldestUndispatchedSeconds: number;
  dueBacklogCount: number;
  oldestDueBacklogSeconds: number;
  manualCount: number;
  processingCount: number;
  expiredProcessingCount: number;
  staleExpiredProcessingCount: number;
  leaseLost15mCount: number;
  lastSuccessfulTickAt: string | null;
  lastHeartbeatAt: string | null;
}

export interface EventObservabilityAlert {
  code: string;
  severity: 'DEGRADED' | 'BLOCKED';
  value: number | boolean | null;
  threshold: number | boolean | null;
}

export interface EventObservabilitySummary {
  status: EventRolloutStatus;
  mode: 'preflight' | 'canary';
  evaluatedAt: string;
  metrics: EventObservabilityMetrics;
  alerts: EventObservabilityAlert[];
}

export interface EventOperationsSummary {
  counts: Record<EventDeliveryStatus, number>;
  recent24Hours: { total: number; succeeded: number; successRate: number };
  longestBacklogSeconds: number;
  worker: EventWorkerSummary;
  observability: EventObservabilitySummary;
}

export interface EventDeliveryPage {
  list: EventDeliverySummary[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface EventDeliveryListQuery {
  page?: number;
  pageSize?: number;
  status?: EventDeliveryStatus;
  eventType?: string;
  handlerCode?: string;
  objectType?: 'ADMIN_OPERATION';
  objectId?: string;
  from?: string;
  to?: string;
  sortBy?: EventDeliverySortKey;
  sortOrder?: SortOrder;
}

export type EventSubscriptionFilterSummary =
  | { mode: 'ALL' }
  | { mode: 'INVALID' }
  | {
    mode: 'FILTERED';
    conditions: Array<{ field: string; operator: 'EQ' | 'IN'; valueCount: number }>;
  };

export interface EventSubscriptionSummary {
  id: string;
  code: string;
  eventType: string;
  eventVersion: number;
  handlerCode: string;
  status: 'ENABLED' | 'DISABLED';
  internal: boolean;
  filterSummary: EventSubscriptionFilterSummary;
  createdAt: string;
  updatedAt: string;
}

export interface EventDeliveryRetryResult {
  id: string;
  status: 'PENDING';
  version: number;
}
