# Local Preproduction Read-Only Database-State Classifier Review Package

status: READY_FOR_I5_INDEPENDENT_REVIEW
utcPrepared: 2026-07-27T11:09:15.8822547Z

## Authoritative inputs and SHA-256

- Approved design: `docs/superpowers/specs/2026-07-27-local-preproduction-read-only-database-state-classifier-design.md` — `24A89B00E4A3CBD242B4820C64F956EF242EA599A825D5C3D0047BF870DB0B5F`
- Approved plan: `docs/superpowers/plans/2026-07-27-local-preproduction-read-only-database-state-classifier.md` — `BC827788E919E11C357B30789DCECB06E54579624C964C3CD43C3B0352F72DFC`
- Classifier: `.codex-safe/Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1` — `57369E6B28AA4CACE93A854A46947A71CB6E611838DC5D8C324D4762014ECB3F`
- Classifier tests: `.codex-safe/tests/LocalPreproduction.DatabaseStateClassifier.Tests.ps1` — `FED97F842684C19D1855ECCB845F5242E75AC3A2FF7733F47BDE3B7577A6028E`
- Task 1 report: `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/task-1-report.md` — `F6365D3A6FBB065E8F317BDBC475EBB872AA706A0B44FDC74A3BED4C13B038CC`
- Controller fix report: `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/task-2-controller-fix1-report.md` — `E89E82A91B5357C1FC01DD9C75A28ED413D2129507E632B5311FF7B4431E7387`
- Original blocked independent review: `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/task-2-review.md` — `CDDA7CACDB082D458B0FEB7F55FA2AE724C29B0D428FE18CD4E92CC5C613DCF8`
- I1-I4 fix report: `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/task-2-fix2-report.md` — `4BE4E0C05C26F77433E0B1A9748DE9711BFF67D4FBAEAA33A26E855D8D8E1026`
- First re-review: `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/task-2-rereview.md` — `A1859C42E72C169BAAA847D2F6B5D7F42D5A1876EB0AF4947C81EEE3EEA759EB`
- Workflow timing-test fix report: `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/task-2-workflow-test-fix-report.md` — `B8521D75D97D1A4347BA1B1214F37940A057A39F0A5915B54F9DDE02EF4A8411`
- Final blocked review identifying I5: `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/task-2-final-review.md` — `EE23770130955B34A3CC1E283E659BD1736D4ACF7FB8FAB06A2645A9DA37746B`
- I5 fix report: `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/task-2-i5-fix-report.md` — `F44F106C060FCFA4311D6C2EBB6C27E57A1A6710D8736DBFE96AF50DE5B6DCDB`
- Core module: `.codex-safe/LocalPreproduction.Core.psm1` — `0C28DD37192D842DF7E4BC158148552CF300A7CC3CFAAA4BD474EAF28A52C541`
- Initializer: `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1` — `FA75F3C91A4D7391E9D5058F59B5A6D4EEA11A127D345D2F0B4849FA2229FC3B`
- Core tests: `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1` — `7A8EDE92343E17416AD10DA36C2C00354706F0F4F78293B3D0464A0CDCF990FF`
- Workflow tests: `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1` — `D9C9EDEA94787140FCFFB40E854E717296DC0B85AE1C2924677AE33E3AEFCBE6`
- Isolated Compose override: `.codex-safe/local-preproduction.compose.override.yml` — `51B43B3DF081E3C0A5E05785C11621DAB73B38E8A067B8F5277036AB517BE31A`
- Base Compose file: `LayerManage/law-firm-system/infra/postgres/compose.yml` — `370BF292030A25A6F89B4CCC3A59E6269C4739F1935F383F628F3111F51EA0BC`

## Controller verification

- finalAuthoritativeRegressionTotal: 197
- finalAuthoritativeRegressionPassed: 197
- finalAuthoritativeRegressionFailed: 0
- finalAuthoritativeRegressionSkipped: 0
- finalAuthoritativeRegressionElapsedSeconds: 183.3
- focusedClassifierTotal: 81
- focusedClassifierPassed: 81
- focusedClassifierFailed: 0
- focusedClassifierSkipped: 0
- astFiles: 6
- astErrors: 0
- psqlProbeSites: 2
- exactReadOnlyOptionSites: 2
- timeout15000Sites: 2
- fixedComposeBuilderReferences: 2
- baseOnlyComposeSites: 0
- directOutputWriters: 0
- migrationLogReferences: 0
- sqlWriteOrProceduralTokens: 0
- protectedHashChecks: 3
- protectedHashMatches: 3
- classificationCodeSetMatches: true
- alertCodeSetMatches: true
- baselinePrecedesCompose: true
- readOnlyGuardPrecedesProbeTwo: true
- targetGuardPrecedesProbeTwo: true
- metadataGuardPrecedesProbeTwo: true
- fixedPrismaPathSites: 2
- recursiveBaselineSearchSites: 0
- originalImportantFindings: 4
- originalImportantFindingsClaimedFixed: 4

## Disclosed non-passing verification evidence

- The implementer combined regression exceeded its original 120-second bound without totals. It was not recorded as passing.
- The first controller full combination completed with 165 total, 164 passed, 1 failed, and 0 skipped.
- The failure was not reproduced in Core plus classifier (90/90), Workflow plus classifier (124/124), or the next full combination (165/165).
- After controller test hardening, the final authoritative fresh combination completed 166/166.
- The original independent review then returned BLOCKED with four Important findings; that report remains preserved unchanged.
- The I1-I4 repair added production model/migration set equality, internal approved-table set comparison, corrected state/arithmetic rules, and the complete dedicated boundary matrix.
- After those fixes, the focused classifier suite completed 79/79 and the final authoritative fresh combination completed 195/195.
- The first re-review reduced the findings to one remaining I4 mutation-resistance gap. Comma-separated source mutants and a same-count production-baseline substitution test were then added; the classifier suite completed 80/80.
- Two subsequent 196-item combinations each exposed the same pre-existing descendant-tree timing-test failure. Safe diagnostic evidence identified that the test waited for convergence but asserted its pre-wait sample.
- The Workflow test was corrected to resample after its existing bounded wait. Its focused termination group completed 6/6, and the final authoritative fresh combination completed 196/196.
- The final review closed I1-I4 and the Workflow fix but identified I5: expected plus unexpected names could be smaller than the distinct-name count.
- I5 was reproduced RED at 80/81, fixed with one exact partition-equality change, and verified at 81/81 focused. After one disclosed 197/196/1 combination and a 116/116 diagnostic, the final authoritative fresh combination completed 197/197.
- The earlier timeout and single failure remain disclosed and are not rewritten as passing runs.

## Exact global constraints

- No Git or GitHub command of any kind.
- Do not rerun the initializer or migration.
- Do not reset, delete, rewrite, seed, repair, assert application emptiness, run a bootstrap contract, bootstrap, or request operator secrets.
- Do not delete, skip, or rewrite Event Center history.
- Do not add or change a remote Worker toggle.
- The preserved isolated database is diagnostic-only and remains untouched until independent readiness.
- The default Compose project and its volume containing 87 user tables remain unreachable.
- No business-table rows and no migration log values may be read.
- Every real probe must start in PostgreSQL-enforced read-only mode and have bounded statement, lock, and native timeouts.
- Every probe must use the fixed isolated Compose target and ordered two-file prefix.
- Any malformed, incomplete, multiline, unexpected, failed, timed-out, or unconfirmed native result must block without retry.
- Safe evidence is limited to status, booleans, bounded counts, stable codes, UTC, and elapsed duration.
- No URL, credential, payload, raw database error, stack, host, PID, worker identity, or lock-owner detail may be emitted.
- A classifier result never authorizes a write or follow-on recovery action.
- A single live classifier invocation is permitted only after independent readiness is exactly READY.

## Prohibited-operation counts

- liveDatabaseClassifierExecutions: 0
- liveDockerOperations: 0
- liveDatabaseConnections: 0
- livePrismaOperations: 0
- livePackageManagerOperations: 0
- initializerExecutions: 0
- migrationExecutions: 0
- resetExecutions: 0
- bootstrapExecutions: 0
- networkOperations: 0
- operatorInputOperations: 0
- defaultVolumeAccess: 0
- gitOrGitHubCommands: 0

## Required independent review questions

1. Is PostgreSQL read-only mode effective from session start for both probes?
2. Are the fixed isolated Compose target and ordered two-file prefix mandatory for every native call?
3. Is the default project and volume unreachable from classifier construction?
4. Does any baseline drift block before Compose or database access?
5. Does Probe 1 read only approved catalog/schema metadata and no business rows?
6. Does Probe 2 read only the three approved migration-metadata columns and emit aggregate counts without logs or names?
7. Are Probe 2, all five state classifications, and all seven guard failures correctly ordered and fail-stop?
8. Can raw or sensitive native output reach the record or any additional stream?
9. Are native containment and termination guarantees preserved?
10. Are the offline tests mutation-resistant, including both final argument vectors and SQL source allowlists?
11. Did any live or prohibited operation occur?
12. Does the disclosed transient evidence prevent an unsupported readiness claim?

## Required report

Write `.codex-safe/sdd/local-preproduction-read-only-database-state-classifier/task-2-i5-review.md` containing:

```text
SPEC_COMPLIANCE=PASS|FAIL
TASK_QUALITY=PASS|FAIL
Critical=<count>
Important=<count>
Minor=<count>
READ_ONLY_DATABASE_STATE_LAUNCH_READINESS=READY|BLOCKED
```

Include safe evidence, findings, transient-evidence disposition, UTC, elapsed duration, and prohibited-operation counts. Do not run the full regression again unless a specific unresolved review question requires a focused offline check. Do not modify implementation or test files.
