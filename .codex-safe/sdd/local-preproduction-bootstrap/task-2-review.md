# Task 2 Independent Review

## Verdicts

- SPEC_COMPLIANCE: BLOCKED
- TASK_QUALITY: BLOCKED
- Severity counts: HIGH 2, MEDIUM 3, LOW 0
- Acceptance blocker count: 2

The current loader satisfies several baseline requirements: it requests the two pinned packages explicitly, requires one discoverable `npx.cmd`, imports the 16-name allow list at Process scope, forces the Worker value to false, maps ordinary missing/invalid bundle outcomes, and emits the expected record shape on covered paths. It is not acceptable yet because executable provenance and failure atomicity are not fail-closed under adversarial conditions.

## Findings

### HIGH 1 - The final toolchain check can fall back to or be shadowed by an executable outside the resolved child context

- File/line: `.codex-safe/Load-ChengyeOALocalPreproduction.ps1:123`, `:129`, `:137`, `:170`, `:176`, `:183`
- The resolver object is not required to have exactly two scalar string fields. The reported Node executable is checked only for being rooted and present; it is not directly version-probed or required to be the executable later selected by name. The original Process PATH is appended before `Test-PinnedToolchain` invokes command names. Therefore a reported existing non-Node leaf, a missing Node command in its directory, or a conflicting command in either prepended directory can cause the final check to use an ambient or shadowing executable while still returning READY. The selected npm command is directly probed once, but the final name-based recheck is not proven to resolve to that same file.
- Bounded fix: require an exact resolver schema with two nonempty scalar strings; canonicalize rooted child PATH entries; require the reported Node leaf to be the expected command; probe the reported Node file and the single selected npm file directly for exact versions before mutation; reject cross-directory command shadowing; and prove the post-prepend command resolution maps to those same canonical files. Keep the original PATH only after both pinned directories.

### HIGH 2 - Failure handling is not transactionally atomic when validation, mutation, or rollback throws

- File/line: `.codex-safe/Load-ChengyeOALocalPreproduction.ps1:188`, `:190`, `:195`, `:201`, `:209`, `:213`, `:215`, `:224`, `:230`, `:231`, `:234`, `:238`
- Environment validation is outside a protective transaction after PATH has changed. A validation exception exits without restoring PATH or emitting the one safe record. Every rollback calls the Process environment setter directly; an exception restoring one variable aborts restoration of the remaining variables and can skip PATH restoration. The same issue exists in earlier PATH rollback branches. A status-record construction failure after successful mutation can also leave the committed state without the required record.
- Bounded fix: snapshot PATH and all 16 values before any mutation, stage every validation first, then commit in one guarded block. Centralize rollback in a non-short-circuit routine that independently attempts every variable and PATH restoration, verifies the restored snapshot, and maps internal failures to one stable safe result. Add injectable environment and record operations so mutation and rollback exceptions are testable without real scope writes.

### MEDIUM 1 - Toolchain tests do not resist resolver/provenance mutations

- File/line: `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:38`, `:41`, `:73`, `:80`, `:85`, `:305`, `:318`, `:345`
- The fake boundary covers absence, a version mismatch, duplicate matching npm commands, and resolver launch failure. It does not cover multiple available `npx.cmd` commands, extra/missing/wrong-type resolver fields, malformed or multiline resolver output, a rooted but unrelated reported executable, a nonexistent Node command beside that executable, relative or quoted child PATH segments, separator edge cases, or command shadowing that reaches the appended ambient PATH. Consequently the suite does not detect HIGH 1.
- Bounded fix: add controlled child-process cases for each listed resolver and PATH mutation and require `TOOLCHAIN_VERSION_MISMATCH`, one record, and a byte-for-byte unchanged Process snapshot on every failure.

### MEDIUM 2 - The test harness discards the streams needed to prove no raw error or stack leakage

- File/line: `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:178`, `:180`, `:182`, `:231`, `:232`, `:235`, `:258`, `:331`, `:370`
- Loader stderr is discarded inside the child and the child stderr is discarded again by the parent. Assertions therefore inspect only the harness JSON, not all loader output. An uncaught exception or unsafe error stream can be hidden while the leakage assertion still passes. Several failure cases also do not explicitly require `invocationFailed=false`.
- Bounded fix: capture every PowerShell stream in memory, normalize it into a test-only envelope without printing it, require exactly one loader record and no additional stream records, scan the captured content for forbidden categories, and explicitly require no uncaught invocation failure in every case.

### MEDIUM 3 - Atomicity, module failure, and Worker-force claims are weakly tested and the checkpoint overstates that evidence

- File/line: `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:132`, `:133`, `:164`, `:178`, `:220`, `:226`; `.codex-safe/sdd/local-preproduction-bootstrap/task-2-report.md:15`, `:18`, `:19`, `:38`
- No test injects validation exceptions, failures during the 16 assignments, failures during rollback, PATH restoration failures, safe-record failures, or either module import failure. The Worker assertion is mutation-weak because the valid bundle already contains false; deleting the explicit force operation would still pass. The checkpoint's captured-output and forbidden-match claims are therefore broader than the exercised evidence.
- Bounded fix: introduce narrow injected operations, fail each commit and rollback position, verify all 16 values plus PATH against the snapshot, test both module failures, seed a conflicting prior Worker value, and regenerate the checkpoint using only evidence actually captured across all streams.

## Fresh Sanitized Test Evidence

- Focused workflow suite: total 9, passed 9, failed 0, skipped 0, elapsed 11 seconds.
- Combined Task 1 and Task 2 suite: total 50, passed 50, failed 0, skipped 0, elapsed 11 seconds.
- Aggregate executions across the two fresh runs: total 59, passed 59, failed 0, skipped 0.
- Green tests do not change either verdict because the confirmed defects are outside the covered mutation set.

## Operation Counts

- Sanitized Pester suite invocations: 2.
- Review artifact writes: 1.
- Real loader invocations: 0.
- Real fixed bundle creations: 0.
- Network operations: 0.
- Docker operations: 0.
- Database operations: 0.
- Project npm operations: 0.
- Git operations: 0.
- GitHub operations: 0.

## Acceptance Boundary

Task 2 should remain BLOCKED until both HIGH findings are fixed and new tests demonstrate direct resolved-executable provenance, exact resolver parsing, complete rollback under injected exceptions, exactly one safe record on every outcome, and all-stream leakage resistance. Re-run the focused and combined suites after those changes.
