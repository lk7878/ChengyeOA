# Local Preproduction Migration Order Task 1

status: READY_FOR_REVIEW
stableClassification: MIGRATION_ORDER_TASK_1_VERIFIED
alertCodes: []
utcEnd: 2026-07-27T04:42:37.3553184Z

## TDD RED bounded counts

- runs: 1
- total: 2
- passed: 0
- failed: 2
- skipped: 0
- expectedFailureNamesMatched: 2
- successOrderFailures: 1
- failStopAggregateFailures: 1
- failStopFixturesCovered: 4
- stableCodes:
  - DEPLOY_BEFORE_ASSERT_MISSING
  - MIGRATION_ASSERT_FAIL_STOP_MISSING
- utcStart: 2026-07-27T04:37:42.7298444Z
- utcEnd: 2026-07-27T04:37:46.7450393Z
- elapsedSeconds: 4.008

## Focused GREEN bounded counts

- migrationOrderRuns: 1
- migrationOrderTotal: 2
- migrationOrderPassed: 2
- migrationOrderFailed: 0
- migrationOrderSkipped: 0
- exactSuccessOrderCases: 1
- failStopFixtures: 4
- hiddenBootstrapRuns: 1
- hiddenBootstrapTotal: 2
- hiddenBootstrapPassed: 2
- hiddenBootstrapFailed: 0
- hiddenBootstrapSkipped: 0
- utcStart: 2026-07-27T04:38:20.2238169Z
- utcEnd: 2026-07-27T04:38:39.9458326Z
- elapsedSeconds: 7.745

## Complete regression bounded counts

- runs: 1
- priorBaselineTotal: 110
- addedTests: 2
- expectedTotal: 112
- total: 112
- passed: 112
- failed: 0
- skipped: 0
- utcStart: 2026-07-27T04:39:03.8653591Z
- utcEnd: 2026-07-27T04:40:48.9053205Z
- elapsedSeconds: 105.035

## Static bounded counts

- astFiles: 4
- astErrors: 0
- dockerComposeCallSites: 7
- fixedPrefixMissing: 0
- baseOnlyOperationalCalls: 0
- deployBeforeAssert: 1
- scopedDestructiveSites: 1
- broadDestructiveSites: 0
- migrationCommands: 1
- assertCommands: 1
- contractCommands: 1
- migrationTimeoutMatches: 1
- assertTimeoutMatches: 1
- contractTimeoutMatches: 1
- hiddenBootstrapArgumentLists: 2
- redirectedBootstrapStreams: 0
- protectedFilesChecked: 4
- protectedFilesUnchanged: 4
- utcStart: 2026-07-27T04:41:44.9594311Z
- utcEnd: 2026-07-27T04:42:14.7763586Z
- elapsedSeconds: 0.454

## Implementation bounded counts

- initializerFilesModified: 1
- workflowTestFilesModified: 1
- reportFilesCreated: 1
- migrationBlocksMoved: 1
- assertionReadyStatesAdded: 1
- nativeCommandsChanged: 0
- nativeTimeoutsChanged: 0
- coreFilesModified: 0
- loaderFilesModified: 0
- assertionScriptFilesModified: 0
- composeFilesModified: 0
- hiddenBootstrapBlocksModified: 0

## Fail-stop bounded counts

- migrationNonzeroFixtures: 1
- migrationLaunchFixtures: 1
- assertionNonzeroFixtures: 1
- assertionLaunchFixtures: 1
- migrationFailureAssertionCalls: 0
- migrationFailureContractCalls: 0
- migrationFailureBootstrapCalls: 0
- assertionFailureMigrationCalls: 1
- assertionFailureAssertionCalls: 1
- assertionFailureContractCalls: 0
- assertionFailureBootstrapCalls: 0
- assertionFailureMigratedReadyRecords: 1

## Prohibited-operation counts

- liveDocker: 0
- liveDatabase: 0
- liveMigration: 0
- liveInitializer: 0
- liveBootstrap: 0
- livePackageManager: 0
- liveNpm: 0
- liveNpx: 0
- network: 0
- operatorInput: 0
- defaultVolumeAccess: 0
- git: 0
- github: 0
- externalMutation: 0
