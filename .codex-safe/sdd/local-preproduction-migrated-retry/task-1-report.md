# Local Preproduction Migrated Retry Task 1

status: READY_FOR_REVIEW
stableClassification: MIGRATED_RETRY_TASK_1_VERIFIED
alertCodes:
  - TRANSIENT_TEST_FAILURE_NOT_REPRODUCED
utcEnd: 2026-07-27T07:09:16.2868062Z

## TDD RED bounded counts

- validRuns: 1
- total: 4
- passed: 1
- failed: 3
- skipped: 0
- expectedProductionFailuresMatched: 3
- helperValidationPassed: 1
- stableClassification: MIGRATED_RETRY_BRANCH_MISSING
- utcStart: 2026-07-27T06:57:22.1527461Z
- utcEnd: 2026-07-27T06:57:30.9521584Z
- elapsedSeconds: 8.784
- hostPolicyBlockedClassifications: 1
- hostPolicyStableClassification: HOST_EXECUTION_POLICY_BLOCKED

## Focused GREEN bounded counts

- retryRuns: 1
- retryTotal: 4
- retryPassed: 4
- retryFailed: 0
- retrySkipped: 0
- successfulRetryScenarios: 3
- unsafeStateScenarios: 4
- resumeFailStopScenarios: 4
- invalidStateFixtures: 6
- freshOrderRuns: 1
- freshOrderTotal: 2
- freshOrderPassed: 2
- freshOrderFailed: 0
- freshOrderSkipped: 0
- hiddenBootstrapRuns: 1
- hiddenBootstrapTotal: 2
- hiddenBootstrapPassed: 2
- hiddenBootstrapFailed: 0
- hiddenBootstrapSkipped: 0
- focusedTotal: 8
- focusedPassed: 8
- focusedFailed: 0
- focusedSkipped: 0
- utcStart: 2026-07-27T06:58:24.9123905Z
- utcEnd: 2026-07-27T06:59:10.0972264Z
- elapsedSeconds: 16.823

## Complete regression bounded counts

- runs: 2
- expectedTotalPerRun: 116
- run1Total: 116
- run1Passed: 115
- run1Failed: 1
- run1Skipped: 0
- run1StableClassification: TRANSIENT_TEST_FAILURE_NOT_REPRODUCED
- run1UtcStart: 2026-07-27T06:59:31.4485179Z
- run1UtcEnd: 2026-07-27T07:01:56.0111775Z
- run1ElapsedSeconds: 144.558
- run2Total: 116
- run2Passed: 116
- run2Failed: 0
- run2Skipped: 0
- run2FailureReproductions: 0
- run2UtcStart: 2026-07-27T07:02:31.9956981Z
- run2UtcEnd: 2026-07-27T07:04:55.7397200Z
- run2ElapsedSeconds: 143.721
- authoritativePassingRuns: 1
- authoritativePassingTotal: 116
- authoritativePassingPassed: 116
- authoritativePassingFailed: 0
- authoritativePassingSkipped: 0

## Stateful bounded counts

- completeEmptySecondInvocationScenarios: 3
- completeEmptySecondInvocationResetCalls: 0
- completeEmptySecondInvocationPreAssertCallsPerScenario: 1
- completeEmptySecondInvocationDeployCallsPerScenario: 1
- completeEmptySecondInvocationPostAssertCallsPerScenario: 1
- directUnsafeStates: 2
- partialRowSecondInvocationStates: 2
- unsafeSecondInvocationResetCalls: 0
- unsafeSecondInvocationDeployCalls: 0
- unsafeSecondInvocationContractCalls: 0
- unsafeSecondInvocationBootstrapCalls: 0
- resumeDeployFailureScenarios: 2
- resumeDeployFailureAssertCallsPerScenario: 1
- resumeDeployFailureDeployCallsPerScenario: 1
- resumeDeployFailureMigratedRecordsPerScenario: 0
- resumePostAssertFailureScenarios: 2
- resumePostAssertFailureAssertCallsPerScenario: 2
- resumePostAssertFailureDeployCallsPerScenario: 1
- resumePostAssertFailureMigratedRecordsPerScenario: 1

## Static bounded counts

- astFiles: 4
- astErrors: 0
- composeOperationalCalls: 7
- fixedBuilderReferences: 7
- baseOnlyOperationalCalls: 0
- scopedDestructiveSites: 1
- freshOnlyDestructiveSites: 1
- resumeDestructiveSites: 0
- assertCommandTimeoutMatches: 2
- deployCommandTimeoutMatches: 1
- contractCommandTimeoutMatches: 1
- hiddenBootstrapArgumentLists: 2
- redirectedBootstrapStreams: 0
- persistentEnvironmentSetters: 0
- remoteWorkerToggles: 0
- protectedFilesChecked: 4
- protectedFilesUnchanged: 4
- retryCountInitializers: 1
- retryCountSets: 1
- utcStart: 2026-07-27T07:08:24.4826781Z
- utcEnd: 2026-07-27T07:08:25.3109735Z
- elapsedSeconds: 0.819

## Implementation and self-review bounded counts

- initializerFilesModified: 1
- workflowTestFilesModified: 1
- reportFilesCreated: 1
- progressFilesAppended: 1
- productionCountsAdded: 1
- freshBranchesAdded: 1
- resumeBranchesAdded: 1
- preResumeAssertionsAdded: 1
- nativeCommandsChanged: 0
- nativeTimeoutsChanged: 0
- hiddenBootstrapBlocksModified: 0
- coreFilesModified: 0
- loaderFilesModified: 0
- assertionScriptFilesModified: 0
- composeFilesModified: 0
- selfReviewRequirementGroups: 9
- selfReviewConcerns: 0

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
