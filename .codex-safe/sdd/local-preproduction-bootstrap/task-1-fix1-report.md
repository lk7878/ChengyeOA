# Task 1 Fix Round 1 Safe Checkpoint

## Classification

- Scope: local preproduction Task 1 fix round 1 only
- Final status: READY
- Review findings closed: 7/7

## Files changed

- `.codex-safe/LocalPreproduction.Core.psm1`
- `.codex-safe/New-ChengyeOALocalPreproductionBundle.ps1`
- `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1`
- `.codex-safe/sdd/local-preproduction-bootstrap/task-1-fix1-report.md`

## Group evidence

- Group 1 RED: total 3, passed 0, failed 3; focused GREEN 3/3.
- Group 2 initial test RED: total 2, passed 0, failed 2; corrected focused GREEN 4/4.
- Group 3 initial test RED: total 1, passed 0, failed 1; corrected focused GREEN 1/1.
- Group 4 characterization GREEN: 1/1.
- Group 5 RED: total 4, passed 3, failed 1; focused GREEN 4/4.
- Group 6 characterization GREEN: 4/4.
- Group 7 characterization GREEN: 3/3.
- Fresh full GREEN: total 40, passed 40, failed 0.
- Fresh AST parse: files 3/3, errors 0.
- Captured-output forbidden matches: 0.

## Per-finding closure

1. Important physical storage boundary: closed by three physical-target runtime cases and stable rejection mapping.
2. Important independent protection and encoding evidence: closed by four direct runtime checks.
3. Important access-control semantics: closed by complete directory and effective-file rule checks.
4. Important atomic non-overwrite and redirected targets: closed by one synchronized writer race plus the three physical-target cases.
5. Minor exact-key matrix: closed for 16/16 exact keys, 16/16 omissions, 16/16 casing substitutions, and extras.
6. Minor protected malformed-content matrix: closed by four protected-content cases.
7. Minor safe schemas and dependency failures: closed by three runtime cases with durable field count 8/8.

## Root categories and fix counts

- `DRIVE_ROOT_TRIMMED`: production fix count 1.
- `DPAPI_SCOPE_OBSERVABILITY`: test fix count 1.
- `FILE_RULE_INHERITANCE_NORMALIZATION`: test fix count 1.
- `CASE_INSENSITIVE_PRESENCE_CHECK`: production fix count 1.

## Alert codes exercised

- `SECRET_STORAGE_PATH_INVALID`
- `SECRET_BUNDLE_ALREADY_EXISTS`
- `SECRET_BUNDLE_INVALID`
- `ENV_REQUIRED_MISSING`
- `ENV_UNEXPECTED_KEY`
- `MODULE_IMPORT_FAILED`
- `PREFLIGHT_SNAPSHOT_MISMATCH`
- Final alert codes: none.

## UTC verification window

- Start: `2026-07-26T09:35:13.2271579Z`
- End: `2026-07-26T09:35:16.0406925Z`
- Elapsed seconds: 2

## Operation counts

- Docker operations: 0
- Database operations: 0
- Project command operations: 0
- Git operations: 0
- GitHub operations: 0
- Real fixed bundle creations: 0

## Residual risks

- Current-user protection and access-control behavior remain Windows-context dependent.
- Cross-account recovery was not attempted; the runtime scope assertion uses the DPAPI blob scope flag with a machine-scope control.
- Later bootstrap tasks remain outside this fix round.
