# Task 2 I5 Aggregate-Partition Fix Report

utcCompleted: 2026-07-27T11:09:15.8822547Z

## Root cause

The expected-name and unexpected-name counts are disjoint and exhaustive over distinct migration names. The classifier rejected only a sum greater than the distinct count, so a smaller contradictory sum could reach a READY classification.

## TDD evidence

- RED: total 81, passed 80, failed 1, skipped 0. The new literal fixture had one distinct name but zero expected and zero unexpected names and required `DATABASE_STATE_INCONSISTENT`.
- The minimal production change replaced the greater-than comparison with exact inequality for the partition sum.
- Intermediate GREEN check exposed three older fixtures with the same impossible partition; production validation stayed strict and those fixtures were corrected to values the aggregate SQL can produce.
- Final focused classifier suite: total 81, passed 81, failed 0, skipped 0.
- Final authoritative Core/Workflow/classifier combination: total 197, passed 197, failed 0, skipped 0; elapsed 183.3 seconds.

## Static evidence

- AST files: 6; parse errors: 0.
- Expected/unexpected partition equality sites: 1.
- Read-only probe sites: 2; 15000-millisecond timeout sites: 2; fixed Compose builder references: 2.
- Direct output writers, migration-log references, SQL write/procedural tokens, base-only Compose sites, and recursive baseline searches: 0.
- Protected Core/Compose hashes: 3 checked, 3 matched.

## Disclosed transient evidence

- The first post-I5 full combination completed 197 total, 196 passed, 1 failed, and 0 skipped without a named in-memory failure object.
- A subsequent safe Core/Workflow diagnostic completed 116/116, and the next fresh authoritative full combination completed 197/197.
- The non-passing run remains disclosed and is not rewritten as passing.

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

## SHA-256

- `Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1`: `57369E6B28AA4CACE93A854A46947A71CB6E611838DC5D8C324D4762014ECB3F`
- `LocalPreproduction.DatabaseStateClassifier.Tests.ps1`: `FED97F842684C19D1855ECCB845F5242E75AC3A2FF7733F47BDE3B7577A6028E`
- `LocalPreproduction.Workflow.Tests.ps1`: `D9C9EDEA94787140FCFFB40E854E717296DC0B85AE1C2924677AE33E3AEFCBE6`
