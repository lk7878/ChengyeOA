# PostgreSQL Backup and Restore

Use this rehearsal only against the local Docker baseline. `var/backup` is Git-ignored. It may create and drop only `chengye_oa_restore_test`; it never drops the development or test application database.

```powershell
$ErrorActionPreference = 'Stop'

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory)] [string] $Name,
        [Parameter(Mandatory)] [scriptblock] $Command
    )

    & $Command
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "$Name failed with exit code $exitCode. Stop the rehearsal and inspect the failure."
    }
}

Set-Location D:\2_test\16_ChengyeOA\LayerManage\law-firm-system
New-Item -ItemType Directory -Force var\backup | Out-Null
Invoke-CheckedCommand 'pg_dump' { docker compose -f infra/postgres/compose.yml exec -T postgres pg_dump -U chengye_app -d chengye_oa -Fc -f /tmp/chengye_oa.dump }
Invoke-CheckedCommand 'copy dump from container' { docker cp chengye-oa-postgres:/tmp/chengye_oa.dump var\backup\chengye_oa.dump }
Invoke-CheckedCommand 'drop restore rehearsal database' { docker compose -f infra/postgres/compose.yml exec -T postgres dropdb -U chengye_app --if-exists chengye_oa_restore_test }
Invoke-CheckedCommand 'create restore rehearsal database' { docker compose -f infra/postgres/compose.yml exec -T postgres createdb -U chengye_app chengye_oa_restore_test }
Invoke-CheckedCommand 'copy dump into container' { docker cp var\backup\chengye_oa.dump chengye-oa-postgres:/tmp/chengye_oa-restore.dump }
Invoke-CheckedCommand 'pg_restore' { docker compose -f infra/postgres/compose.yml exec -T postgres pg_restore -U chengye_app -d chengye_oa_restore_test --no-owner --no-privileges /tmp/chengye_oa-restore.dump }
$env:DATABASE_URL='postgresql://chengye_app:chengye_local_only@localhost:55432/chengye_oa_restore_test?schema=public'
Invoke-CheckedCommand 'empty application table assertion' { npm.cmd run db:assert-empty }
```

Capture the start and end timestamps, dump SHA-256, elapsed time, restore result, and the 22-model empty assertion in the task report. Stop immediately on a `pg_dump`, `docker cp`, `createdb`, `pg_restore`, or empty assertion failure. Do not repair a failed rehearsal automatically and do not commit the dump.
