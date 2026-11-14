# ChengyeOA Local Preproduction Migration Failure Handoff

**Date:** 2026-07-27

**Status:** BLOCKED at live migration; isolated database preserved

## Workspace

- Workspace: `D:\2_test\16_ChengyeOA`
- Project: `D:\2_test\16_ChengyeOA\LayerManage\law-firm-system`
- Portable runtime: `apps/dist/law-firm-system/`

## Absolute constraints

- No Git or GitHub commands.
- Do not delete, skip, or rewrite Event Center history.
- Do not add a remote Worker toggle.
- Do not print URLs, credentials, payloads, raw database errors, stacks, host, PID, worker identity, or lock-owner details.
- Evidence is limited to safe status, bounded counts, stable alert codes, UTC, and elapsed duration.
- Do not automatically retry the initializer or migration.
- Preserve the isolated database for investigation.
- The existing default volume containing 87 user tables remains unreachable and untouched.

## Completed implementation and review

- Local preproduction Compose isolation is implemented and independently approved.
- Fresh zero-table flow is fixed to deploy before application-row assertion.
- Same-version migrated-state retry is implemented and independently approved.
- Controller regression: 116/116, failed 0, skipped 0.
- Controller static gate: READY.
- Independent retry review:
  - `ORIGINAL_IMPORTANT_FINDING=ADDRESSED`
  - `SPEC_COMPLIANCE=PASS`
  - `TASK_QUALITY=PASS`
  - Critical/Important/Minor: 0/0/0
  - `LAUNCH_READINESS=READY`
- Evidence directory: `.codex-safe/sdd/local-preproduction-migrated-retry/`

## Operator-shell toolchain resolution

The current operator PowerShell was repaired process-locally without exposing paths:

- original npx candidates: 2;
- retained the npx candidate whose adjacent npm was not already 10.9.2;
- removed one rejected PATH entry;
- deduplicated one PATH entry;
- child PATH duplicate entries: 0;
- exact child npm candidates: 1;
- Node pinned: true;
- loader final status: READY;
- loader alert codes: none.

The current PowerShell contains the loaded local-preproduction environment. Keep that window open. A new Codex task will not inherit its process environment.

## Live attempt

One initializer attempt was authorized and executed. Safe phases:

- `ISOLATED_BASELINE_READY`: READY
- `ISOLATED_DATABASE_EMPTY`: READY
- `DATABASE_READY`: READY
- `MIGRATION`: BLOCKED
- stable code: `MIGRATION_FAILED`
- UTC start: `2026-07-27T07:50:31.5320639Z`
- UTC blocked: `2026-07-27T07:51:08.0075077Z`
- elapsed seconds: 36

Fail-stop evidence:

- migration-ready records: 0;
- post-migration assertion attempts: 0;
- bootstrap-contract attempts: 0;
- operator secret prompts: 0;
- administrator bootstrap attempts: 0;
- automatic retries: 0;
- destructive recovery attempts after failure: 0;
- default-volume access: 0.

Live report: `.codex-safe/sdd/local-preproduction-migrated-retry/live-report.md`

## Offline evidence after failure

- Root deploy script exists and delegates to the server workspace.
- Server deploy script invokes Prisma migration deployment.
- Migration directories: 12.
- Migration SQL files: 12.
- Prisma schema: present.
- Server Prisma CLI package: present.
- Server Prisma command shim: present.
- Server Prisma client: present.
- Lockfile: present.
- No live migration rerun was performed.

## Current diagnostic breakpoint

The next action is a zero-database-connection launch-chain classifier in the existing operator PowerShell. It must:

1. confirm 16/16 required process variables without printing values;
2. confirm Node 22.14.0 and npm 10.9.2;
3. confirm production mode and Worker disabled;
4. run the local server Prisma version command with npm forced offline and capture output without displaying it;
5. run Prisma migration-deploy help with npm forced offline and capture output without displaying it;
6. run the root-to-server deploy delegation with `--help`, still offline, and capture output without displaying it;
7. report only booleans/counts and `MIGRATION_LAUNCH_CHAIN_FAILED` if any boundary fails.

Do not connect to the database until this offline classifier is READY. If it is READY, design a separately reviewed read-only database-state classifier before any further live action.

## Resume prompt for the new task

Continue ChengyeOA local preproduction bootstrap from this handoff. Read this file first, then the approved design, implementation plan, live report, and independent review in `.codex-safe/sdd/local-preproduction-migrated-retry/`. Use systematic debugging, subagent-driven review where implementation is required, and verification-before-completion. Do not repeat the initializer or migration. Start at the zero-database-connection migration launch-chain classifier in the existing operator PowerShell.
