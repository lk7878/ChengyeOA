# Task 1 independent review

## Verdicts

- `SPEC_COMPLIANCE=REJECTED`
- `TASK_QUALITY=REJECTED`

Finding counts: Critical `1`; Important `4`; Minor `1`.

## Review basis and constraints

This review is based only on the supplied brief, implementation report, review-package manifest, and the two packaged snapshots. No tests were rerun. No Git, network, database, production, or project Event Center command was used. No production input value or raw diagnostic content is reproduced here.

## Critical findings

### C1 — The physical path boundary can be crossed through an in-root reparse-point ancestor

Location: `task-1-review-package/ProductionRolloutRunner.Core.psm1.snapshot`, lines 179–213; missing coverage at `task-1-review-package/ProductionRolloutRunner.Core.Tests.ps1.snapshot`, lines 214–219.

The writer checks a normalized path string and the resolved parent string against the safe-root prefix, and checks only whether the final target itself is a link. It does not reject or physically resolve reparse points/junctions in the parent or any ancestor. A path whose textual form is beneath the safe root can therefore traverse an in-root reparse-point directory to a destination outside that root while passing both prefix checks. The temporary file and final move both use that untrusted parent path. This violates the required “target remains below the safe root” invariant and permits an out-of-bound write. The sole boundary test covers lexical traversal only, so it cannot detect this defect.

Required correction: validate every existing path component against reparse points, or obtain and compare the final physical path using a handle-based canonicalization appropriate to Windows, and use only the verified physical parent for temporary and destination operations. Add tests for reparse-point ancestors and link targets.

## Important findings

### I1 — Atomic replacement is asserted but not established

Location: `task-1-review-package/ProductionRolloutRunner.Core.psm1.snapshot`, lines 200–215; report compatibility note describing the replacement choice.

The implementation writes a same-directory temporary file, but then relies on the PowerShell provider operation `Move-Item -Force`. That operation does not by itself establish the required atomic-replacement contract in this implementation or prove failure preservation for an existing target. The report labels it an exact replacement without evidence for that property. A safe writer must use a replacement primitive with documented same-volume atomic semantics and define the first-write case separately.

### I2 — Evidence field names are not matched exactly

Location: `task-1-review-package/ProductionRolloutRunner.Core.psm1.snapshot`, lines 116–125; missing coverage at `task-1-review-package/ProductionRolloutRunner.Core.Tests.ps1.snapshot`, lines 109–127.

The field-set comparisons use PowerShell’s default case-insensitive membership operators, and subsequent property access is also case-insensitive. A receipt containing case-variant field names can therefore be accepted even though the contract requires the exact field set. This is a fail-open schema-validation gap. The tests cover missing and extra fields but not wrong-case names.

### I3 — Valid schema-version values can be rejected solely because of CLR integer representation

Location: `task-1-review-package/ProductionRolloutRunner.Core.psm1.snapshot`, lines 121–123; test fixture and coverage at `task-1-review-package/ProductionRolloutRunner.Core.Tests.ps1.snapshot`, lines 22–31 and 129–137.

The contract requires equality to the supported schema version, but the implementation additionally requires the value to be exactly an `Int32`. Semantically equal integer values represented by another integral CLR type are rejected. This can affect deserialized receipts and is not required by the specification. The test uses only the literal’s default representation and does not cover equivalent integral representations.

### I4 — TDD tests do not exercise the writer’s central safety properties

Location: `task-1-review-package/ProductionRolloutRunner.Core.Tests.ps1.snapshot`, lines 214–241.

The writer tests prove only direct lexical rejection and a successful two-record append. They do not verify reparse-point ancestry, an existing link target, that the temporary file is created in the verified directory, atomic replacement/failure preservation, or cleanup after a forced write/replacement failure. Consequently, the reported passing count does not substantiate the path-boundary and atomic-write requirements. This is material because C1 and I1 survive the full reported suite.

## Minor findings

### M1 — The RED evidence is only a prose aggregate

Location: `task-1-report.md`, section “TDD evidence”; `task-1-review-package/manifest.md`, fresh-verification entry.

The report states RED totals and a sanitized failure category, but the review package contains no captured RED artifact or similarly reviewable evidence tying that failure to the pre-implementation test file. The fresh verification supports the final GREEN state only; it cannot independently establish behavior-first ordering. This weakens, but does not by itself disprove, the TDD claim.

## Checks that passed static review

- The environment gate returns only the required summary fields and does not return environment input values.
- Its required-name count and exact-value checks are fail-closed for ordinary string inputs.
- Evidence freshness is capped at thirty minutes and future and over-age receipts are rejected for the tested UTC inputs.
- Explicit validation failures use stable safe codes rather than echoing rejected values.
- Safe-record top-level keys, non-negative integer counts, alert-code syntax, and address-like scheme rejection are implemented for the validated fields.
- The snapshots contain no network, database, process-launch, or production command behavior.

## Conclusion

Specification compliance is rejected because the writer does not reliably keep physical writes beneath the required root, atomic replacement is not established, and evidence schema matching is not exact. Task quality is rejected because the tests omit the highest-risk filesystem cases and the packaged RED evidence is not independently auditable.
