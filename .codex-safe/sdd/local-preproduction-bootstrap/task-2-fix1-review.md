# Task 2 Fix Round 1 Independent Review

## Verdicts

- SPEC_COMPLIANCE: BLOCKED
- TASK_QUALITY: BLOCKED
- Severity counts: HIGH 1, MEDIUM 1, LOW 0
- Acceptance blocker count: 1
- Original findings fully closed: HIGH 1/2, MEDIUM 2/3
- Original findings partially closed: HIGH 1/2, MEDIUM 1/3

Fix round 1 materially improves executable provenance, transaction staging, rollback continuation, stream capture, module failure mapping, and Worker-force evidence. One ordered runtime requirement remains unmet: exact Node and npm output is not rechecked by executing the commands after the pinned PATH has been committed.

## Original Finding Closure

1. Original HIGH executable provenance: PARTIAL. Exact two-field scalar resolver parsing, rooted canonical child entries, expected Node leaf, direct pre-commit probes, single npm selection, cross-directory shadow rejection, and prospective canonical command resolution are present. The required post-prepend execution recheck is absent.
2. Original HIGH transaction atomicity: CLOSED. PATH plus all 16 Process values are snapshotted before mutation; validation and all result records are staged; rollback attempts all 16 values and PATH independently and verifies the full snapshot.
3. Original MEDIUM provenance coverage: PARTIAL. The resolver/path matrix is substantially expanded, but it cannot detect the missing post-commit execution because no controlled boundary changes between pre-commit probing and post-commit invocation.
4. Original MEDIUM all-stream evidence: CLOSED. The child privately merges loader streams, the parent separately captures child stdout/stderr, and the envelope requires one safe record, no extra stream items, no uncaught invocation, and no forbidden match.
5. Original MEDIUM failure and Worker evidence: CLOSED for validation, allow-list assignments, rollback persistence, staged record failure, both module failures, and observable Worker force. The remaining mutation-position omissions are recorded below as one bounded quality finding.

## Findings

### HIGH 1 - Exact tool versions are not rechecked by execution after PATH is prepended

- File/line: `.codex-safe/Load-ChengyeOALocalPreproduction.ps1:263`, `:296`, `:322`, `:326`, `:373`, `:374`, `:380`, `:398`
- The loader directly probes both resolved files before Process mutation and proves that a prospective PATH would resolve the two command names to those canonical files. It then commits PATH and verifies only the stored PATH string and the 16 environment values. It never executes the pinned command names or resolved files after the prepend.
- Decision: direct pre-commit exact probes plus prospective canonical resolution and post-commit PATH-string verification do not satisfy the plan's ordered requirement to prepend and then recheck exact outputs. They also leave a replacement/time-of-check-to-time-of-use window between the probe and committed operator state.
- Bounded fix: after committing PATH, canonically re-resolve both command names, require equality with the directly probed files, execute both through the normal post-prepend command boundary, and require the two exact outputs. Treat any resolution, launch, or output mismatch as `TOOLCHAIN_VERSION_MISMATCH`, then run the existing complete rollback and snapshot verification before returning the staged blocked record.

### MEDIUM 1 - The failure matrix omits three mutation boundaries and cannot prove the required post-commit recheck

- File/line: `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:270`, `:275`, `:276`, `:535`, `:538`, `:556`, `:604`, `:620`, `:638`; `.codex-safe/sdd/local-preproduction-bootstrap/task-2-fix1-report.md:21`, `:26`, `:27`
- Commit injection counts only non-PATH calls and tests positions 1 through 16. It does not fail the initial PATH commit, the explicit final Worker-force call, or a new post-commit tool execution. The provenance cases are static sandboxes, so none swaps, removes, or changes a resolved executable after the pre-commit probe. The checkpoint therefore overstates full closure of executable provenance and the complete assignment matrix.
- Bounded fix: number every commit mutation, including PATH, all 16 allow-list writes, and the final Worker force; inject each position and require the correct full rollback outcome. Add post-commit Node and npm launch/version failures plus a controlled pre/post replacement case. Regenerate the closure counts from those cases.

## Reviewed Controls Without New Findings

- The optional `TestOperations` surface has no required operator parameter, defaults to the real Process-scope operations, recognizes only four local operation names, and adds no remote Worker toggle. It is acceptable as a test seam within this Task 2 boundary.
- Module import fallback records have fixed safe fields and do not depend on the unavailable modules.
- Rollback is non-short-circuiting: it attempts 17 restorations and independently verifies all 17 snapshot entries.
- Ready, import-failure, and rollback-failure records are constructed before commit, so record construction cannot fail after a partial commit on the default path.
- The all-stream envelope, two module-failure cases, staged-record failure, and observable two-step Worker-force case provide meaningful mutation-resistant coverage for their stated boundaries.

## Fresh Sanitized Test Evidence

- Focused loader suite: total 19, passed 19, failed 0, skipped 0, elapsed 48 seconds.
- Combined Task 1 and Task 2 suite: total 60, passed 60, failed 0, skipped 0, elapsed 51 seconds.
- Aggregate across both fresh runs: total 79, passed 79, failed 0, skipped 0.
- These green results do not close HIGH 1 because the required post-commit execution boundary is absent from both implementation and tests.

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

Task 2 remains BLOCKED until the loader performs and tests an actual exact post-prepend Node/npm execution recheck and rolls back on every resulting failure. The existing prospective canonical resolution should remain as an additional provenance guard, not replace the post-commit execution.
