# Task 1 fix round 1 scoped re-review

## Scoped outcome

- `SCOPED_VERDICT=REJECTED`
- Addressed original findings: `4`
- Open original findings: `1`
- New in-scope Critical/Important breakage: `1`

Original finding verdicts:

- `C1=ADDRESSED`
- `I1=ADDRESSED`
- `I2=ADDRESSED`
- `I3=ADDRESSED`
- `I4=NOT_ADDRESSED`

New-breakage counts: Critical `0`; Important `1`.

## Review basis and constraints

This re-review is limited to the original C1 and I1-I4 findings and new Critical/Important breakage introduced within their fix scope. Minor M1 was not reviewed because it is outside this fix round.

The review used only the supplied original findings, brief, appended implementation report, fix-round manifest, and the three packaged snapshots. No tests were rerun. Reported RED/GREEN counts were treated as package claims rather than independently reproduced evidence. No Git/GitHub, network, database, production, process-launch, or project Event Center command was used. No production input, credential, business-sensitive value, raw runtime error, stack, host, process identity, or worker identity is reproduced.

## Finding verdicts

### C1 — ADDRESSED

Evidence: module snapshot lines 147-173 and 208-223; focused test snapshot lines 65-112.

The writer now rejects a reparse-point safe root, walks every existing component from that root through the already-required existing parent and rejects reparse points, and rejects an existing reparse-point target before creating the temporary file. Temporary and destination paths are then derived from the checked parent. The focused tests cover both an in-root reparse-point ancestor and an existing reparse-point target, including absence of an escaped write in the ancestor case. This addresses the concrete physical-boundary defect described by C1.

### I1 — ADDRESSED

Evidence: module snapshot lines 220-247; focused test snapshot lines 114-140.

Existing targets are replaced with the .NET file-replacement primitive using a same-directory temporary file; first writes use the .NET file-move primitive. The failure path maps the operation to a stable safe code, and `finally` attempts cleanup of temporary and backup artifacts. The focused replacement-failure test checks preservation of the existing target and cleanup after the forced failure. This establishes the correction requested by I1 at the supplied static-review scope.

### I2 — ADDRESSED

Evidence: module snapshot lines 116-126; focused test snapshot lines 22-38.

Both directions of the evidence field-set comparison now use case-sensitive membership. Only after that exact-name check succeeds does the implementation access the required properties. The focused test supplies a case-variant required name and expects field-set rejection. The original case-insensitive schema gap is closed.

### I3 — ADDRESSED

Evidence: module snapshot lines 121-123; focused test snapshot lines 40-62.

The implementation now accepts all listed integral CLR representations when their numeric value equals the supported schema version and rejects a non-integral representation. The focused parameterized coverage includes multiple non-default integral representations. This resolves the original representation-specific rejection described by I3.

A separate new Important breakage in the same changed logic is recorded below; it does not change the verdict on the original I3 condition.

### I4 — NOT_ADDRESSED

Evidence: baseline test snapshot lines 214-242; focused test snapshot lines 65-140.

The focused suite materially improves coverage: it exercises an ancestor reparse point, an existing reparse-point target, and replacement-failure preservation plus artifact cleanup. The baseline append test also exercises an ordinary successful replacement outcome.

However, the original I4 finding explicitly identified missing verification that the temporary file is created in the verified directory and missing cleanup coverage for forced write/replacement failure paths. The new failure test forces only the existing-target replacement branch and inspects artifacts only in the expected directory. It would still pass if temporary creation were redirected elsewhere, and there is no forced temporary-write or first-write-move failure case. Thus the suite still does not directly exercise all of the writer safety properties identified by I4, so the finding is only partially corrected and remains open under the required binary verdict.

## New in-scope breakage

### NB1 — Important: a missing schema-version value can bypass safe invalid-result handling through an unhandled runtime failure

Location: module snapshot lines 121-123; missing focused coverage at focused test snapshot lines 40-62.

The new integral-type logic calls runtime type inspection directly on the schema-version value. Exact field-set validation permits the required property to be present with no value. In that case, type inspection fails before the function can return the required safe invalid status and stable alert code. The pre-fix type predicate rejected this input without invoking a method on it, so this is a regression introduced within the I3 correction.

Required correction: guard the value before runtime type inspection, return the stable schema-invalid result for an absent value, and add a focused regression test for a present schema-version property with no value.

## Conclusion

The scoped fix round is rejected. Four of the five original Critical/Important findings are addressed, but I4 remains partially open and the I3 change introduces one new Important fail-safe regression. Minor M1 remains explicitly outside this review.
