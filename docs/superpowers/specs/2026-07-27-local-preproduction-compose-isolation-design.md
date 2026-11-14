# ChengyeOA Local Preproduction Compose Isolation Design

**Date:** 2026-07-27

**Status:** User-approved design option A; pending written-spec review

## Context

The existing default Compose volume contains 87 user tables. It is not an empty local-preproduction target and must never be deleted, reset, renamed, mounted by the new local-preproduction project, or treated as disposable.

The current initializer uses the base Compose file without a fixed project name. Its pre-reset empty-table check therefore reaches the existing default project. The check correctly fails closed, but a fresh isolated local-preproduction database cannot be initialized.

## Goal

Create a dedicated local-preproduction Compose project that reuses the authoritative PostgreSQL service definition while receiving its own container resource, network, and physical volume. Preserve the existing default project and its data unchanged.

## Non-Goals

- Do not migrate, copy, inspect business rows, back up, delete, or rewrite the existing default database.
- Do not change production deployment topology or add a remote Worker toggle.
- Do not modify Event Center history.
- Do not generalize the initializer to accept caller-supplied project, service, volume, or override names.
- Do not use Git or GitHub commands.

## Architecture

### Fixed Compose identity

The local-preproduction initializer will use all three fixed inputs on every Compose invocation:

- the existing authoritative base Compose file;
- a new minimal local-preproduction override file;
- one fixed local-preproduction Compose project name.

The override changes only the explicit container resource name. The fixed project name gives the logical volume a distinct physical Compose namespace, so the base project's physical volume is never selected.

The target resolver will accept no caller-supplied identity values. It will resolve both files through the existing physical-boundary checks, require the exact service set and logical volume set, and return an immutable target object used by every later Compose call.

### Safe initialization sequence

The isolated project is initialized in this order:

1. Validate the DPAPI bundle, process environment, production mode, Worker-disabled state, confirmation switch, fixed Compose project, base file, override file, service set, and logical volume set.
2. Run a non-destructive scoped `up -d` for the isolated project.
3. Wait for bounded database health.
4. Execute the fixed empty-table count against the isolated database and accept exactly one unsigned integer.
5. If the count is nonzero or cannot be proven, return `BLOCKED` and never issue `down --volumes`.
6. If and only if the count is zero, run the existing scoped `down --volumes` against the isolated project.
7. Recreate the isolated project, repeat bounded health verification, then continue migration, bootstrap-contract verification, hidden administrator bootstrap, backup, and preflight.

The initial non-destructive start is required because a brand-new Compose project has no running database in which to prove the zero-table condition. It does not authorize deletion; deletion remains gated by the successful count.

### Data isolation invariants

- Every operational Compose command includes the fixed project name plus both fixed Compose files.
- No command may target the base Compose file alone.
- No command may accept a service, volume, project, or file path from operator input.
- No global Docker listing, prune, direct volume removal, container identifier, or computed destructive target is allowed.
- The existing default project is never stopped, started, inspected for deletion, or passed to a destructive command by the revised initializer.
- A pre-existing isolated project is treated as untrusted: it must pass the same health and zero-table proof before reset.

## Components and Responsibilities

### Minimal override file

`.codex-safe/local-preproduction.compose.override.yml` contains only the PostgreSQL service override necessary to prevent collision with the base project's explicit container resource name. It does not duplicate credentials, ports, health checks, image configuration, or volume definitions.

### Target resolver

`Get-LocalPreproductionComposeTarget` will produce a fixed target object containing only internally resolved operational values. Safe records expose counts and status only, never resolved paths or resource names.

### Initializer orchestration

`Initialize-ChengyeOALocalPreproduction.ps1` will construct every metadata, start, health, empty-check, reset, and restart call from the target object. The Task 4 migration and hidden-bootstrap sequence remains unchanged after the post-reset `DATABASE_READY` state.

### Tests

Pester tests use injected native operations only. They must prove exact argument order and fail-stop behavior without starting Docker, connecting to a database, resolving packages, or requesting operator input.

## Failure Handling

- Invalid or missing fixed project/override metadata: `COMPOSE_TARGET_INVALID`.
- Baseline isolated start failure: `DATABASE_START_FAILED`.
- Either bounded health window expires: `DATABASE_HEALTH_TIMEOUT`.
- Empty-table command failure, malformed output, or unconfirmed termination: existing safe database or native-termination alert code.
- Nonzero isolated user-table count: `DATABASE_NOT_EMPTY`.
- Scoped volume reset failure: `DATABASE_RESET_FAILED`.
- Any failure stops all later migration and bootstrap calls.

No raw Docker, Compose, database, package-manager, or bootstrap output is emitted.

## Verification and Review Gates

Implementation must use TDD and provide meaningful RED evidence before modifying orchestration.

Required tests include:

- every Compose call contains the fixed project, base file, and override file;
- base-only or caller-controlled targets are impossible;
- the first start occurs before the first health and empty-table check;
- nonzero or malformed table counts produce zero destructive calls;
- only the proven-zero path contains exactly one scoped `down --volumes`;
- the isolated restart is followed by a second bounded health check;
- all existing Task 1 through Task 4 safety tests remain green;
- live Docker, database, initializer, bootstrap, and operator-input counts remain zero during implementation and review.

After implementation, a fresh independent reviewer must return zero Critical and Important findings before any isolated resource is created. Root verification must then re-run the complete suite and the fixed loader gate.

## Authorized Live Boundary

After all implementation and review gates pass, the operator may run the revised initializer in the already approved interactive PowerShell boundary. The live run may create and reset only the dedicated isolated project. The existing default volume with 87 user tables remains untouched.

## Safe Evidence

Record only status, bounded counts, stable alert codes, UTC timestamps, and elapsed duration. Do not record resolved resource names, paths, connection details, credentials, command payloads, raw errors, process information, or Worker ownership fields.
