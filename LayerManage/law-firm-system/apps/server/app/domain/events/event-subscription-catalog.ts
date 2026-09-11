export interface EventSubscriptionCatalogEntry {
  readonly id: string;
  readonly code: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly handlerCode: string;
  readonly status: 'ENABLED' | 'DISABLED';
  readonly filterJson: null;
}

export const EVENT_DISPATCH_QUARANTINE_SUBSCRIPTION_ID = 'subscription:event-dispatch-quarantine-v1';
export const EVENT_DISPATCH_QUARANTINE_HANDLER_CODE = 'EVENT_DISPATCH_QUARANTINE';

export const EVENT_SUBSCRIPTION_CATALOG = Object.freeze([
  Object.freeze({
    id: 'subscription:admin-operation-reviewed-notification-v1',
    code: 'admin-operation-reviewed-notification-v1',
    eventType: 'admin.operation.reviewed',
    eventVersion: 1,
    handlerCode: 'ADMIN_OPERATION_REVIEWED_NOTIFICATION',
    status: 'ENABLED',
    filterJson: null,
  }),
  Object.freeze({
    id: EVENT_DISPATCH_QUARANTINE_SUBSCRIPTION_ID,
    code: 'event-dispatch-quarantine-v1',
    eventType: 'system.event.quarantine',
    eventVersion: 1,
    handlerCode: EVENT_DISPATCH_QUARANTINE_HANDLER_CODE,
    status: 'DISABLED',
    filterJson: null,
  }),
  Object.freeze({
    id: 'subscription:lead-first-response-monitor-v1',
    code: 'lead-first-response-monitor-v1',
    eventType: 'lead.assigned',
    eventVersion: 1,
    handlerCode: 'LEAD_FIRST_RESPONSE_MONITOR',
    status: 'ENABLED',
    filterJson: null,
  }),
] satisfies readonly EventSubscriptionCatalogEntry[]);
