# Task 2 Workflow Timing-Test Fix Report

utcCompleted: 2026-07-27T10:42:23.1075899Z

## Scope

- Changed only `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`.
- The descendant-tree termination test already allowed a bounded 3500-millisecond convergence wait, but it asserted the pre-wait sample. The test now resamples both bounded resource locks after that existing wait.
- Core, initializer, product runtime, Compose, migration SQL, Event Center, Worker configuration, and classifier behavior were not changed by this fix.

## Evidence

- RED focused termination group: total 6, passed 5, failed 1, skipped 0.
- GREEN focused termination group: total 6, passed 6, failed 0, skipped 0.
- Final authoritative Core/Workflow/classifier combination: total 196, passed 196, failed 0, skipped 0; elapsed 279.2 seconds.
- The earlier full-combination failures remain disclosed; their safe failing name was the descendant-tree termination timing test.

## Safety

- liveDockerOperations: 0
- liveDatabaseConnections: 0
- initializerExecutions: 0
- migrationExecutions: 0
- resetExecutions: 0
- bootstrapExecutions: 0
- networkOperations: 0
- operatorInputOperations: 0
- defaultVolumeAccess: 0
- gitOrGitHubCommands: 0

## SHA-256

- `LocalPreproduction.Workflow.Tests.ps1`: `D9C9EDEA94787140FCFFB40E854E717296DC0B85AE1C2924677AE33E3AEFCBE6`
- `Invoke-ChengyeOAReadOnlyDatabaseStateClassifier.ps1`: `5E8002B85A4A43467B49754E98640380375586C92156EA6CF87F5E0D60C40AB8`
- `LocalPreproduction.DatabaseStateClassifier.Tests.ps1`: `59600D783073CD55034FF6D0630FD4AB21BA5B658D521D2C87CFF83B637706FC`
