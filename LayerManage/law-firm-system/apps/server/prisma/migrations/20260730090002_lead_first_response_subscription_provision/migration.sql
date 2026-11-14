-- SPEC-009 lead first-response monitor subscription provisioning
-- The third catalog entry (app/domain/events/event-subscription-catalog.ts,
-- lead-first-response-monitor-v1, ENABLED first-response pilot) had no migration
-- provisioning: 20260722120000_reliable_event_center provisioned
-- admin-operation-reviewed-notification-v1 and 20260722143000_event_dispatch_quarantine
-- provisioned event-dispatch-quarantine-v1 only. Without this row, fresh bootstrap
-- fails the catalog parity assertion (SystemBootstrapService.assertEventSubscriptionCatalog
-- length check) and already-initialized databases silently never dispatch lead.assigned
-- to the pilot handler. Mirrors the 20260730090000_crm_permission_provision lesson.
-- Pattern follows the two existing event_subscription INSERTs: same column set,
-- id = 'subscription:<code>', filterJson NULL, ON CONFLICT ("code") DO NOTHING.

INSERT INTO "event_subscription" (
  "id", "code", "eventType", "eventVersion", "handlerCode", "status", "filterJson", "createdAt", "updatedAt"
) VALUES (
  'subscription:lead-first-response-monitor-v1',
  'lead-first-response-monitor-v1',
  'lead.assigned',
  1,
  'LEAD_FIRST_RESPONSE_MONITOR',
  'ENABLED',
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;
