# Task 2 Live Gate Fix Round 1 Safe Checkpoint

## Classification

- Scope: local preproduction Task 2 live gate only.
- Final status: READY.
- Stable pre-fix alert: `TOOLCHAIN_VERSION_MISMATCH`.
- Root category: `MISSING_INHERITED_PATH_OVERREJECTION`.

## Root cause

- The real fixed-package resolver completed successfully and returned the exact two-field contract.
- The fixed Node executable existed and returned the exact required version.
- The child PATH contained 24 entries. Six inherited entries were syntactically valid absolute paths but did not currently exist.
- Exactly one npm command returned the exact required version.
- The loader treated any nonexistent inherited PATH directory as a toolchain ambiguity before it could accept the unique exact npm match.
- This condition exceeded Task 2's contract: nonexistent unrelated inherited directories cannot provide a competing npm command and do not weaken executable provenance.

## TDD evidence

- New behavior: accept a syntactically valid nonexistent inherited child PATH directory when the exact pinned Node/npm pair remains unique and all provenance checks pass.
- Focused RED: total 23, passed 22, failed 1.
- RED classification: `MISSING_INHERITED_PATH_OVERREJECTION`.
- Focused GREEN: total 23, passed 23, failed 0.
- Minimal production change: preserve canonicalization and duplicate rejection, then skip only nonexistent directories before looking for npm.

## Regression and live verification

- Task 1-4 full Pester: total 95, passed 95, failed 0, skipped 0; elapsed 93 seconds.
- Real loader gate: READY; elapsed 4 seconds.
- Loader record type correct: true.
- Fixed Node version Boolean: true.
- Fixed npm version Boolean: true.
- Environment imported count: 16.
- Toolchain-ready count: 1.
- Worker disabled Boolean: true.
- Loader environment scope: one disposable PowerShell process only; the process exited after verification.
- AST parse: files 2, errors 0.
- User/Machine environment setters: 0.
- Remote Worker toggles: 0.

## Resolver and operation counts

- Controlled real resolver invocations: 2.
- Network-backed package resolution invoked: true.
- Raw resolver streams emitted: 0.
- Database operations: 0.
- Container operations: 0.
- Initializer operations: 0.
- Bootstrap operations: 0.
- Operator secret input requests: 0.
- Git operations: 0.
- GitHub operations: 0.

## Preserved fail-closed controls

- Exact Node and npm versions remain mandatory.
- Resolver schema, rooted path syntax, expected Node leaf, direct pre-commit probes, unique npm match, command shadow checks, committed command resolution, and post-commit exact probes remain enforced.
- Invalid, relative, quoted, empty, duplicate, ambiguous, shadowed, missing-tool, launch-failure, and version-mismatch cases remain blocked.
- No remote toggle and no event-history mutation were introduced.

## Verification UTC

- Final static verification: `2026-07-27T00:31:22.8478043Z`.
