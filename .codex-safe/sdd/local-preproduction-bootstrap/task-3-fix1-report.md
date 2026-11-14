# Task 3 Fix Round 1 Safe Checkpoint

## Classification

- Scope: local preproduction Task 3 fix round 1 of 5.
- Final status: READY_FOR_INDEPENDENT_REVIEW_ONLY.
- Review findings addressed: critical 2/2, important 3/3, minor 1/1.
- `LIVE_RESET_EXECUTED=0`
- `RESET_READY_ONLY=1`

## Files changed

- `.codex-safe/LocalPreproduction.Core.psm1`
- `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1`
- `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`
- `.codex-safe/sdd/local-preproduction-bootstrap/task-3-fix1-report.md`

## Grouped TDD evidence

- Native boundary initial RED: total 4, passed 0, failed 4; categories `NATIVE_TIMEOUT_CONTRACT_MISSING` and `EMPTY_OPERAND_REJECTED`.
- Native boundary intermediate: total 4, passed 3, failed 1; category `EMPTY_ECHO_OBSERVER`.
- Native exact-type RED: total 4, passed 3, failed 1; 8/11 schema mutations blocked before the type fix.
- Native boundary final GREEN: total 4, passed 4, failed 0; 11/11 noisy, malformed, cardinality, key, and type mutations blocked.
- Physical-boundary corrected RED: total 1, passed 0, failed 1; root/ancestor walker unsafe acceptances 2/2.
- Physical-boundary GREEN: total 1, passed 1, failed 0; unsafe acceptances 0/2 and metadata calls 0.
- Health-termination RED: total 1, passed 0, failed 1; bounded cases 0/3.
- Health-termination GREEN: total 1, passed 1, failed 0; bounded cases 3/3.
- Initializer stream isolation and destructive contract: total 2, passed 2, failed 0 after test-fixture corrections; these characterize behavior supplied by the native fix and the already exact production query.
- Environment equality RED: total 1, passed 0, failed 1; uniform mismatch cases 11/16.
- Environment equality GREEN: total 1, passed 1, failed 0; uniform mismatch cases 16/16.
- Final original-plus-fix Task 3 matrix: total 19, passed 19, failed 0.
- Fresh Task 1 through Task 3 suite: total 82, passed 82, failed 0, skipped 0.
- Root categories reaching three failed production fixes: 0.

## Finding closure

1. C1 native deadline: closed by concurrent asynchronous stdout/stderr drains, nonreplaceable monotonic wait accounting, bounded process wait, timeout termination, sanitized timeout result, and remaining-budget health calls. Local hang and dual-pipe-fill fixtures pass within short bounds.
2. C2 physical target: closed by walking every existing component from the filesystem root through the canonical leaf. Repository-root and ancestor junction fixtures are rejected before metadata in 2/2 cases.
3. I1 health termination: closed by a nonreplaceable 120-second Stopwatch budget plus a maximum of five attempts. Constant, regressing, and no-op injected time fixtures return one timeout record in 3/3 cases.
4. I2 injected streams: closed by private all-stream capture, exact one-result cardinality, exact three-field injected schema, exact value types, and rejection of warning, error, verbose, debug, information, malformed, extra, missing, multiple, and wrong-type results.
5. I3 destructive contract: closed by one immutable 17-token count-command fixture with exact fixed SQL, four token-array mutations, four private quoting expectations, and four operands round-tripped through a harmless local echo child.
6. M1 environment equality: closed by independently changing every one of the fixed sixteen Process names; all 16 return only `ENVIRONMENT_BUNDLE_MISMATCH` before metadata or destructive work.

## Root categories and fix counts

- `NATIVE_TIMEOUT_AND_CONCURRENT_DRAIN`: production change set count 1.
- `EMPTY_ARGUMENT_PIPELINE_LOSS`: production fix count 1.
- `FULL_ANCESTOR_REPARSE_WALK`: production fix count 1.
- `FINITE_MONOTONIC_HEALTH_GUARD`: production fix count 1.
- `INJECTED_EXACT_SCHEMA_TYPES`: production fix count 1.
- `ENVIRONMENT_EQUALITY_ORDER`: production fix count 1.
- `REPARSE_IMPORT_RESOLUTION_OBSERVER`: test correction count 1.
- `EMPTY_BASE64_LINE_OBSERVER`: test correction count 1.
- `COUNT_FIXTURE_HERESTRING_SCOPE`: test correction count 1.
- `COUNT_PREDICATE_SUCCESS_STREAM`: test correction count 1.

## Safe verification evidence

- Fresh full-suite UTC start: `2026-07-26T12:33:00.5664299Z`.
- Fresh full-suite UTC end: `2026-07-26T12:33:59.4467825Z`.
- Fresh full-suite elapsed seconds: 58.
- AST parse: files 3, errors 0.
- Fresh focused all-stream run: total 19, passed 19, failed 0.
- Focused all-stream UTC start: `2026-07-26T12:34:25.0290609Z`.
- Focused all-stream UTC end: `2026-07-26T12:34:30.6105773Z`.
- Focused all-stream elapsed seconds: 5.
- Error records in focused all-stream capture: 0.
- Captured-output forbidden matches: 0.
- Final alert codes: none.

## Bounded fixture evidence

- Hanging local child cases in the final focused run: 1/1 timed out and terminated.
- Dual-pipe-fill local child cases in the final focused run: 1/1 completed without deadlock.
- Local argument-echo cases in the final focused run: 4/4 operands preserved.
- Windows quoting expectations: 4/4.
- Root and ancestor reparse fixtures: 2/2 rejected; metadata calls 0.
- Constant, regressing, and no-op health fixtures: 3/3 bounded; maximum attempts 5.
- Exact SQL/token production calls: 1/1.
- Token mutation rejection: remove, add, reorder, substitute = 4/4.
- Environment mismatch matrix: 16/16 blocked before native work.
- Approved destructive calls per eligible injected invocation: exactly 1.
- Real destructive calls: 0.

## Prohibited-operation counts

- Live initializer invocations: 0.
- Live reset executions: 0.
- Operational native commands: 0.
- Docker operations: 0.
- Compose operations: 0.
- Database operations: 0.
- Network operations: 0.
- Project npm operations: 0.
- Real fixed bundle operations: 0.
- Git operations: 0.
- GitHub operations: 0.
- Later-task operations: 0.
- Harmless local native fixture launches in the final focused run: 3.

## Residual risks

- Real Docker Compose, database, and health behavior remains intentionally unexecuted pending a separate authorization and independent review.
- Timeout termination is exercised against a local child with no descendants; operational commands remain blocked from live execution in this round.
- DPAPI recovery remains tied to the current Windows user and fixed local storage context.
- Migration, administrator bootstrap, backup, runtime launch, and source/portable preflight remain outside this task and were not executed.
