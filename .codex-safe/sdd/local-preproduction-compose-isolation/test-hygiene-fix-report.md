# Local Preproduction Test Hygiene Fix

status: READY_FOR_REVIEW
stableClassification: LOCAL_PREPRODUCTION_TEST_HYGIENE_FIX_VERIFIED
alertCodes:
  - OUT_OF_SCOPE_ALL_TEST_DIRECTORY_FAILED
utcEnd: 2026-07-27T03:49:26.2920073Z

## TDD bounded counts

- loaderRedRuns: 1
- loaderRedTotal: 26
- loaderRedPassed: 25
- loaderRedFailed: 1
- loaderRedStableCode: LOADER_PROCESS_DISPOSE_EXACTLY_ONCE_MISSING
- nativeRedRuns: 1
- nativeRedTotal: 4
- nativeRedPassed: 3
- nativeRedFailed: 1
- nativeRedStableCode: NATIVE_OUTER_CALLER_BOUND_COUPLED
- nativeRedSucceededInvariantFailures: 0
- nativeRedTimedOutInvariantFailures: 0
- loaderGreenRuns: 1
- loaderGreenTotal: 26
- loaderGreenPassed: 26
- loaderGreenFailed: 0
- nativeGreenRuns: 1
- nativeGreenTotal: 4
- nativeGreenPassed: 4
- nativeGreenFailed: 0

## Determinism bounded counts

- loaderDisposeScenarios: 3
- loaderDisposeExactlyOnceVerified: 3
- loaderNormalScenarios: 1
- loaderNonzeroScenarios: 1
- loaderExceptionalScenarios: 1
- nativeInternalTimeoutMilliseconds: 5000
- nativeCallerDelayMilliseconds: 2100
- nativeOuterWatchdogMilliseconds: 8000
- nativeSucceededExpected: 1
- nativeTimedOutExpected: 0

## Verification bounded counts

- relevantFullRuns: 1
- relevantFullTotal: 110
- relevantFullPassed: 110
- relevantFullFailed: 0
- relevantFullSkipped: 0
- relevantFullUtcStart: 2026-07-27T03:48:00.7937259Z
- relevantFullUtcEnd: 2026-07-27T03:49:18.1969042Z
- relevantFullElapsedSeconds: 77.398
- astFiles: 4
- astErrors: 0
- astUtcEnd: 2026-07-27T03:49:26.2920073Z
- exploratoryAllDirectoryRuns: 1
- exploratoryAllDirectoryTotal: 355
- exploratoryAllDirectoryPassed: 298
- exploratoryAllDirectoryFailed: 57
- exploratoryAllDirectorySkipped: 0
- exploratoryAllDirectoryStableCode: OUT_OF_SCOPE_ALL_TEST_DIRECTORY_FAILED
- exploratoryAllDirectoryUtcStart: 2026-07-27T03:46:04.1557783Z
- exploratoryAllDirectoryUtcEnd: 2026-07-27T03:47:36.4512496Z
- exploratoryAllDirectoryElapsedSeconds: 92.286

## Scope bounded counts

- allowedTestFilesChanged: 1
- allowedReportFilesWritten: 1
- coreFilesChanged: 0
- loaderFilesChanged: 0
- initializerFilesChanged: 0
- composeFilesChanged: 0
- docsFilesChanged: 0

## Prohibited-operation counts

- liveDocker: 0
- liveDatabase: 0
- liveInitializer: 0
- liveBootstrap: 0
- livePackageManager: 0
- network: 0
- operatorInput: 0
- git: 0
- github: 0
