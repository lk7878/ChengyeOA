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
  Object.freeze({id:'subscription:quality-assessment-analysis-v1',code:'quality-assessment-analysis-v1',eventType:'quality.assessment.recorded',eventVersion:1,handlerCode:'QUALITY_ASSESSMENT_ANALYSIS',status:'ENABLED',filterJson:null}),
  Object.freeze({id:'subscription:sop-reminder-notification-v1',code:'sop-reminder-notification-v1',eventType:'sop.reminder.due',eventVersion:1,handlerCode:'SOP_REMINDER_NOTIFICATION',status:'ENABLED',filterJson:null}),
  Object.freeze({id:'subscription:sop-change-notification-v1',code:'sop-change-notification-v1',eventType:'sop.task.changed',eventVersion:1,handlerCode:'SOP_CHANGE_NOTIFICATION',status:'ENABLED',filterJson:null}),
  Object.freeze({id:'subscription:quality-change-notification-v1',code:'quality-change-notification-v1',eventType:'quality.changed',eventVersion:1,handlerCode:'QUALITY_CHANGE_NOTIFICATION',status:'ENABLED',filterJson:null}),

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
