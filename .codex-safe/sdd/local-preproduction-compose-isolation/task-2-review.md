# Task 2 Independent Safe Review

## Verdict

- `SPEC_COMPLIANCE=FAIL`
- `TASK_QUALITY=FAIL`
- `Critical=0`
- `Important=1`
- `Minor=0`
- `FINAL_CLASSIFICATION=FAIL`

Task 3 must not begin until the Important finding is fixed and independently re-reviewed.

## Important finding

### I1 - The first metadata failure does not fail-stop the second metadata operation

Locations:

- `.codex-safe/LocalPreproduction.Core.psm1:1263`
- `.codex-safe/LocalPreproduction.Core.psm1:1271`
- `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:1825`

The resolver checks termination confirmation for the first metadata operation, but it does not check that operation's success or validate its exact result before invoking the second metadata operation. Both success checks and both semantic result checks occur only after the second invocation.

A directed injected probe made the first metadata operation return a confirmed execution failure. The resolver returned a blocked result, but the observed injected-operation count was 2 instead of 1. Live-operation count was 0.

This violates the required fail-stop property at every position. It also leaves the focused Task 2 matrix incomplete because that matrix begins at the baseline start and does not cover either metadata boundary. The defect is Important rather than Critical because the continued operation is metadata-only and the reviewed path still cannot reach the destructive operation after either metadata failure.

Required correction and tests:

1. Check first-metadata execution success immediately after its termination-confirmation check.
2. Validate the first metadata result as exactly one expected line before invoking the second metadata operation.
3. Add a fixture where the first metadata execution fails and assert total later calls are 0.
4. Add missing, extra, and incorrect first-metadata result fixtures and assert total later calls are 0.
5. Add second-metadata execution and semantic-failure fixtures and assert the baseline start and every later call are 0.
6. Preserve the existing stable safe classifications and prove all fixtures emit no additional streams.

## Confirmed contract evidence

- The successful injected fixture has exactly 12 calls in the required order.
- The fixed Compose prefix is applied to all 8 successful-fixture Compose calls.
- Readiness order is exactly `ISOLATED_BASELINE_READY`, `ISOLATED_DATABASE_EMPTY`, then `DATABASE_READY` before later states.
- Baseline start precedes baseline health and the table-count proof.
- The destructive operation occurs exactly once only after one exact unsigned zero line.
- Nonzero, missing, multiline, signed, whitespace-polluted, non-integer, and execution-failure fixtures have destructive-call count 0.
- Baseline start, both health gates, count, reset, restart, and all later initialization positions fail closed in the existing covered fixtures.
- Both health gates reuse the same bounded helper and the existing native boundary with Job Object containment, termination confirmation, monotonic timeout, retry, and sleep-budget contracts.
- The initializer exposes no caller-supplied Compose identity parameter and has no base-only operational fallback.
- The fixed two-file target and fixed project namespace keep the existing 87-table default volume unreachable from the reviewed initializer path.
- Safe records contain only the approved bounded schema; reviewed failure paths do not emit raw native output or additional streams.

## Test evidence

- Fresh Task 2 focused: total 3, passed 3, failed 0, skipped 0.
- Directed first-metadata failure probe: total 1, reproduced 1, injected calls 2, live operations 0.
- Full regression was not repeated for this review. The implementation report records total 107, passed 107, failed 0, skipped 0; this is referenced evidence, not fresh reviewer evidence.

## Safe operation counts

- `LIVE_DOCKER=0`
- `LIVE_DATABASE=0`
- `LIVE_INITIALIZER=0`
- `LIVE_BOOTSTRAP=0`
- `LIVE_NPM=0`
- `LIVE_NPX=0`
- `LIVE_NETWORK=0`
- `LIVE_OPERATOR_INPUT=0`
- `LIVE_DEFAULT_VOLUME_ACCESS=0`
- `LIVE_ISOLATED_RESOURCES_CREATED=0`
- `GIT=0`
- `GITHUB=0`
- `EXTERNAL_MUTATION=0`

## Safe completion record

- `alertCodes={METADATA_FAIL_STOP_INCOMPLETE}`
- `LIVE_RESOURCE_CHANGES=0`
