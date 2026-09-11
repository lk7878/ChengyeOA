# Local Preproduction Migrated Retry Live Report

status: BLOCKED
stableClassification: MIGRATION_FAILED

## Safe phases

- ISOLATED_BASELINE_READY: READY
- ISOLATED_DATABASE_EMPTY: READY
- DATABASE_READY: READY
- MIGRATION: BLOCKED
- alertCodes: [MIGRATION_FAILED]

## Timing

- utcStart: 2026-07-27T07:50:31.5320639Z
- utcBlocked: 2026-07-27T07:51:08.0075077Z
- elapsedSeconds: 36

## Fail-stop evidence

- migrationReadyRecords: 0
- databaseAssertAttemptsAfterFailure: 0
- bootstrapContractAttemptsAfterFailure: 0
- operatorSecretInputRequests: 0
- administratorBootstrapAttempts: 0
- automaticRetries: 0
- destructiveRecoveryAttemptsAfterFailure: 0
- isolatedDatabasePreservedForInvestigation: 1
- defaultVolumeAccess: 0

## Investigation boundary

- offlineMigrationAssets: READY
- migrationDirectories: 12
- migrationSqlFiles: 12
- serverPrismaRuntime: READY
- liveMigrationReruns: 0
- rawErrorExposure: 0

