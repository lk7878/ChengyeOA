INSERT INTO "event_subscription" (
  "id", "code", "eventType", "eventVersion", "handlerCode", "status", "filterJson", "createdAt", "updatedAt"
) VALUES (
  'subscription:event-dispatch-quarantine-v1',
  'event-dispatch-quarantine-v1',
  'system.event.quarantine',
  1,
  'EVENT_DISPATCH_QUARANTINE',
  'DISABLED',
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
