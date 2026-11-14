# Task 2 Fix Round 1 Safe Checkpoint

## Classification

- Scope: local preproduction Task 2 fix round 1 only.
- Final status: READY.
- Findings closed: HIGH 2/2, MEDIUM 3/3.

## Files changed

- `.codex-safe/Load-ChengyeOALocalPreproduction.ps1`
- `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`
- `.codex-safe/sdd/local-preproduction-bootstrap/task-2-fix1-report.md`

## Grouped TDD evidence

- Group 1 first RED: total 10, passed 9, failed 1; category `PROVENANCE_SCHEMA_LEAF`.
- Group 1 expanded RED: total 11, passed 9, failed 2; categories `PROVENANCE_SCHEMA_LEAF`, `PROVENANCE_MATRIX`.
- Group 1 focused GREEN: total 11, passed 11, failed 0.
- Transaction core RED: total 14, passed 11, failed 3; categories `VALIDATION_EXCEPTION`, `COMMIT_ROLLBACK`, `ROLLBACK_CONTINUATION`.
- Transaction core focused GREEN: total 14, passed 14, failed 0.
- Group A characterization: assignment positions 16/16, PATH rollback 1/1, staged record failure 1/1, module failures 2/2.
- Group A expanded focused GREEN: total 18, passed 18, failed 0.
- Group B Worker-force characterization: 1/1; expanded focused GREEN 19/19.
- Final focused GREEN: total 19, passed 19, failed 0.
- Final Task 1 + Task 2 GREEN: total 60, passed 60, failed 0.
- Root categories reaching three failed fixes: 0.

## Per-finding closure

1. HIGH executable provenance: closed by 13/13 controlled provenance cases covering exact scalar schema, malformed and multiline output, canonical rooted entries, expected Node leaf, direct exact probes, missing files, multiple npx entries, ambient fallback, cross-directory shadowing, and prospective name-to-file equality.
2. HIGH transaction atomicity: closed by pre-mutation PATH plus 16-value snapshot, fully staged validation and records, guarded commit, 17/17 non-short-circuit rollback attempts, and complete snapshot verification.
3. MEDIUM provenance coverage: closed by the 13-case child-process matrix with stable `TOOLCHAIN_VERSION_MISMATCH`, unchanged snapshots, and exact envelopes.
4. MEDIUM all-stream evidence: closed across 46/46 final focused child cases; forbidden matches 0, uncaught invocations 0, additional stream records 0.
5. MEDIUM failure and Worker evidence: closed by validation exception 1/1, commit positions 16/16, variable rollback persistence 1/1, PATH rollback persistence 1/1, staged record failure 1/1, module failures 2/2, and observable Worker force 1/1.

## Root categories and fix counts

- `PROVENANCE_SCHEMA_LEAF` and `PROVENANCE_MATRIX`: production change set count 1.
- `TRANSACTIONAL_STAGE_COMMIT_ROLLBACK`: production change set count 1.
- `INVALID_RESOLVER_PATHPINNED_DIAGNOSTIC`: test correction count 1.
- Group A production edit count: 0; characterized behavior was already supplied by the transaction change set.
- Worker-force production edit count: 0; explicit force was already correct and is now mutation-observable.

## Safe verification evidence

- AST parse: files 2, errors 0.
- Workflow tests with mutation or characterization annotations: 19/19.
- Final focused child cases: 46.
- Exact safe loader records: 46/46.
- Captured-output forbidden matches: 0.
- Uncaught child invocations: 0.
- Additional loader stream records: 0.

## Verification windows

- Focused UTC start: `2026-07-26T11:07:51.1928726Z`.
- Focused UTC end: `2026-07-26T11:08:36.3620406Z`.
- Focused elapsed seconds: 45.
- Combined UTC start: `2026-07-26T11:08:48.5907308Z`.
- Combined UTC end: `2026-07-26T11:09:35.6168535Z`.
- Combined elapsed seconds: 47.

## Exact test commands

- `Invoke-Pester -Script '.codex-safe\tests\LocalPreproduction.Workflow.Tests.ps1' -TestName 'Local preproduction process-scoped loader' -PassThru -Quiet`
- `Invoke-Pester -Script @('.codex-safe\tests\LocalPreproduction.Core.Tests.ps1', '.codex-safe\tests\LocalPreproduction.Workflow.Tests.ps1') -PassThru -Quiet`

## Alert codes exercised

- `MODULE_IMPORT_FAILED`
- `TOOLCHAIN_VERSION_MISMATCH`
- `SECRET_BUNDLE_MISSING`
- `SECRET_BUNDLE_INVALID`
- `NODE_ENV_NOT_PRODUCTION`
- `ENVIRONMENT_VALIDATION_FAILED`
- `ENVIRONMENT_IMPORT_FAILED`
- `ENVIRONMENT_ROLLBACK_FAILED`
- `SAFE_RECORD_FAILED`
- Final alert codes: none.

## Operation counts

- Final focused child PowerShell cases: 46.
- Final verification Pester suite invocations: 2.
- Network operations: 0.
- Docker operations: 0.
- Database operations: 0.
- Project npm operations: 0.
- Git operations: 0.
- GitHub operations: 0.
- Real loader invocations: 0.
- Real fixed bundle creations: 0.

## Residual risks

- Real network-backed npx package acquisition remains intentionally unexecuted; tests use controlled local child boundaries.
- DPAPI behavior remains tied to the current Windows user context.
- The optional test operations contract is local-only and defaults to the real Process-scope operations; the operator entry still requires no parameters.
- Later bootstrap tasks remain outside this fix round.
