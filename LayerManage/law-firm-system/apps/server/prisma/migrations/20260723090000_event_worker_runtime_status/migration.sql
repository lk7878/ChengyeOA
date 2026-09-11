CREATE TABLE "event_worker_runtime_status" (
  "slot" TEXT NOT NULL,
  "configuredEnabled" BOOLEAN NOT NULL,
  "state" TEXT NOT NULL,
  "processStartedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "lastHeartbeatAt" TIMESTAMP(3) WITH TIME ZONE,
  "lastSuccessfulTickAt" TIMESTAMP(3) WITH TIME ZONE,
  "lastStoppedAt" TIMESTAMP(3) WITH TIME ZONE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

  CONSTRAINT "event_worker_runtime_status_pkey" PRIMARY KEY ("slot"),
  CONSTRAINT "event_worker_runtime_status_primary_slot_check" CHECK ("slot" = 'primary'),
  CONSTRAINT "event_worker_runtime_status_state_check" CHECK ("state" IN ('DISABLED', 'STARTING', 'RUNNING', 'STOPPED')),
  CONSTRAINT "event_worker_runtime_status_version_check" CHECK ("version" >= 1),
  CONSTRAINT "event_worker_runtime_status_running_timestamps_check" CHECK (
    "state" <> 'RUNNING'
    OR ("lastHeartbeatAt" IS NOT NULL AND "lastSuccessfulTickAt" IS NOT NULL)
  ),
  CONSTRAINT "event_worker_runtime_status_stopped_timestamp_check" CHECK (
    "state" <> 'STOPPED'
    OR "lastStoppedAt" IS NOT NULL
  ),
  CONSTRAINT "event_worker_runtime_status_heartbeat_order_check" CHECK (
    "lastHeartbeatAt" IS NULL OR "lastHeartbeatAt" >= "processStartedAt"
  ),
  CONSTRAINT "event_worker_runtime_status_successful_tick_order_check" CHECK (
    "lastSuccessfulTickAt" IS NULL OR "lastSuccessfulTickAt" >= "processStartedAt"
  ),
  CONSTRAINT "event_worker_runtime_status_stopped_order_check" CHECK (
    "lastStoppedAt" IS NULL OR "lastStoppedAt" >= "processStartedAt"
  ),
  CONSTRAINT "event_worker_runtime_status_stopped_after_heartbeat_check" CHECK (
    "lastStoppedAt" IS NULL
    OR "lastHeartbeatAt" IS NULL
    OR "lastStoppedAt" >= "lastHeartbeatAt"
  ),
  CONSTRAINT "event_worker_runtime_status_stopped_after_successful_tick_check" CHECK (
    "lastStoppedAt" IS NULL
    OR "lastSuccessfulTickAt" IS NULL
    OR "lastStoppedAt" >= "lastSuccessfulTickAt"
  )
);
