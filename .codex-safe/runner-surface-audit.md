# Event Center production runner surface audit

Scope: static, read-only inspection only. No database or network connection was made, and no preflight, drain, or canary entry was executed. This report intentionally excludes URLs, configuration values, credentials, payloads, raw database errors, stacks, hosts, process identifiers, worker identifiers, and lock-owner data.

## 1. Preflight / drain / canary runners — 3 existing entries

- Portable preflight and canary check entry: `events:check` in `LayerManage/law-firm-system/apps/server/package.json`; implementation: `LayerManage/law-firm-system/apps/server/scripts/events/check-events.ts`; source runner: `runSourceCheckEvents`.
- Portable drain entry: `events:drain` in `LayerManage/law-firm-system/apps/server/package.json`; implementation: `LayerManage/law-firm-system/apps/server/scripts/events/drain-events.ts`; source runner: `drainMain`.
- The operations runbook is `docs/superpowers/runbooks/reliable-event-center-outbox.md`; the production-canary design and plan are `docs/superpowers/specs/2026-07-23-event-center-production-canary-observability-design.md` and `docs/superpowers/plans/2026-07-23-event-center-production-canary-observability.md`.

Safe-output contract: the check runner emits one compact, deterministic summary containing rollout mode, outcome, bounded operational counters, allow-listed alert codes, and evaluation time. The drain runner emits one compact, deterministic summary containing bounded drain counters and terminal outcome. Both route database failures through typed handling and use exit status; their normal formatted output does not require raw connection details, payloads, or lock/worker identity fields.

## 2. All-instance Worker disable / single-instance enable — 0 existing operator entries

- No ready-to-run operator entry was found for a global, all-instance Worker disable followed by single-instance enable.
- Related implementation-only surfaces exist at `LayerManage/law-firm-system/apps/server/app/application/events/event-worker-runtime-status-store.ts`, `LayerManage/law-firm-system/apps/server/app/application/events/event-operations-service.ts`, and `LayerManage/law-firm-system/apps/server/app/controller/eventOperations.ts`, but the inspected sources do not provide the required global/single-instance operational command entry.

## 3. Governance-event generation — 1 existing application entry

- Application-level generation/sink entry: `GovernanceEventSink` in `LayerManage/law-firm-system/apps/server/app/application/admin-governance/governance-event-sink.ts`.
- This is a reusable in-process application surface, not a discovered standalone production operator CLI.

## 4. Machine-verifiable recovery/version/approval evidence — 0 complete production evidence entries

- Backup/restore guidance exists at `docs/superpowers/runbooks/postgresql-backup-restore.md` and `docs/superpowers/runbooks/reliable-event-center-outbox.md`.
- Rehearsal-only code exists at `LayerManage/law-firm-system/apps/server/scripts/rehearsal/rehearse-event-center-restore.ts` and `LayerManage/law-firm-system/apps/server/scripts/rehearsal/rehearse-backup-factor.ts`.
- No single existing, machine-verifiable production entry was found that jointly proves backup point, isolated restore point, matching Server/Web release, and approval evidence.

## Safety conclusion

Reusable runner surfaces exist for check/preflight/canary and drain, with compact safe summaries. The required coordinated global Worker control and complete machine-verifiable recovery/release/approval evidence surface do not currently exist as ready operator entries. Governance emission exists only as an application-level reusable sink.
