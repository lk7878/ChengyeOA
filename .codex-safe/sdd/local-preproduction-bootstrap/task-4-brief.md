# Task 4 brief — Migration and Hidden Administrator Bootstrap

Authority: Global Constraints and Task 4 in the approved local-preproduction plan.

Modify initializer and workflow tests only as needed. Do not run the real initializer, reset, Docker/database/project npm, or interactive bootstrap during implementation.

Required exact progression after Task 3 database health READY:

1. `npm.cmd run db:assert-empty`
2. `npm.cmd run db:deploy`
3. `npm.cmd run check:bootstrap`
4. emit one safe `WAITING_OPERATOR_SECRET_INPUT` record
5. invoke `npm.cmd run system:bootstrap` directly with inherited console, no password argument, no redirected stdin/stdout/stderr, and no prompt capture
6. emit final `ADMIN_BOOTSTRAPPED` READY state only on exit zero

Run from the fixed project root with current validated Process environment and pinned PATH. Noninteractive output/errors are captured and discarded through the safe native boundary. Stable failure codes: DATABASE_NOT_EMPTY, MIGRATION_FAILED, BOOTSTRAP_CONTRACT_FAILED, ADMIN_BOOTSTRAP_FAILED. Any nonzero/launch exception stops later commands. State order must be `DATABASE_READY -> MIGRATED -> BOOTSTRAP_CONTRACT_READY -> WAITING_OPERATOR_SECRET_INPUT -> ADMIN_BOOTSTRAPPED` with safe schema/counts/UTC/elapsed only.

Use local-only injected operations to test exact file/arguments/working directory/order; zero secret arguments; inherited console flags; every failure position; one waiting record; no later calls after failure; and no forbidden output. The Task 3 reset/destructive gates must remain unchanged and green.

Strict TDD, systematic debugging, focused/full Task1–4 tests, AST/all-stream scan. No Git/GitHub/network/real operations. Write task-4-report.md and state `LIVE_INITIALIZATION_EXECUTED=0`, `OPERATOR_SECRET_INPUT_REQUESTED=0` during implementation.
