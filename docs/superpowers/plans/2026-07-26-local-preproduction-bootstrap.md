# ChengyeOA Local Preproduction Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and execute a fail-closed, local-only ChengyeOA preproduction bootstrap that uses an empty PostgreSQL container, DPAPI-protected secrets, production runtime validation, hidden administrator initialization, and source/portable Event Center preflight agreement.

**Architecture:** Focused PowerShell scripts under `.codex-safe` provide secret protection, process-scoped environment loading, verified empty-database reinitialization, bootstrap orchestration, and preflight comparison. Existing repository database, bootstrap, portable runtime, and production-runner contracts remain authoritative; the new scripts wrap them without changing application source or embedding secrets.

**Tech Stack:** Windows PowerShell 5.1, DPAPI `CurrentUser`, Pester 3, Docker Compose, PostgreSQL 16, Node 22.14.0, npm 10.9.2, existing ChengyeOA TypeScript/Prisma commands, existing Windows portable executable.

## Global Constraints

- Treat this host as local preproduction, not final online production.
- Use `NODE_ENV=production` and require `EVENT_WORKER_ENABLED=false` through bootstrap and initial preflight.
- Bind the application to loopback and stop it if listener verification observes a non-loopback binding.
- Store no plaintext `.env`, password, token, connection string, or encryption key in the repository or status output.
- Never print URL, credential, payload, raw database error, stack, host, process identifier, worker identifier, or lock owner.
- Output only safe phase/status fields, bounded counts, alert codes, UTC timestamps, and elapsed time.
- Use exact Node 22.14.0 and npm 10.9.2.
- Reset only the verified empty PostgreSQL Compose volume; never use broad Docker cleanup.
- Do not delete, skip, rewrite, or repair Event Center history manually.
- Do not add a remote Worker toggle.
- Do not execute Git or GitHub commands.
- Stop immediately on `BLOCKED`; investigate and extend observation on `DEGRADED`.
- Use `%LOCALAPPDATA%\ChengyeOA\local-preproduction` as the only secret/backup storage root and restrict its ACL to the current Windows user plus `SYSTEM`.

---

## File Structure

- Create `.codex-safe/LocalPreproduction.Core.psm1`: pure secret generation/protection, environment validation, safe record construction, Compose target resolution, and source/portable snapshot comparison.
- Create `.codex-safe/New-ChengyeOALocalPreproductionBundle.ps1`: one-time creation of the DPAPI-protected bundle with no secret output and no silent overwrite.
- Create `.codex-safe/Load-ChengyeOALocalPreproduction.ps1`: pinned-toolchain activation plus DPAPI bundle import into the current PowerShell process.
- Create `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1`: one-time guarded empty-volume reset, database startup, migration, bootstrap checks, and interactive administrator bootstrap.
- Create `.codex-safe/Invoke-ChengyeOALocalPreproductionPreflight.ps1`: local runtime launch, loopback listener check, source/portable preflight, snapshot comparison, and safe shutdown behavior.
- Create `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1`: pure module tests with no Docker or database connection.
- Create `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`: orchestration tests using injected native-command stubs and temporary directories.
- Reuse `.codex-safe/ProductionRolloutRunner.Core.psm1`: pinned toolchain, production environment gate, safe command execution, and Event Center summary conversion.
- Reuse `LayerManage/law-firm-system/infra/postgres/compose.yml`: the sole allowed Docker Compose definition.
- Reuse `LayerManage/law-firm-system/apps/dist/law-firm-system/law-firm-system.exe`: portable server and portable preflight command.
- Reuse root npm scripts `db:assert-empty`, `db:deploy`, `check:bootstrap`, and `system:bootstrap`.

### Task 1: DPAPI Secret and Validation Core

**Files:**
- Create: `.codex-safe/LocalPreproduction.Core.psm1`
- Create: `.codex-safe/New-ChengyeOALocalPreproductionBundle.ps1`
- Test: `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1`

**Interfaces:**
- Produces: `New-LocalPreproductionMaterial -ApplicationPort <int> -DatabasePort <int> -> [ordered dictionary]`.
- Produces: `Protect-LocalPreproductionBundle -Material <IDictionary> -LiteralPath <string> -> void`.
- Produces: `Unprotect-LocalPreproductionBundle -LiteralPath <string> -> [hashtable]`.
- Produces: `Test-LocalPreproductionEnvironment -Environment <IDictionary> -> safe status record`.
- Produces: `Compare-EventPreflightSnapshot -Source <object> -Portable <object> -> safe status record`.
- Produces: one-time bundle creation command that returns `SECRET_BUNDLE_ALREADY_EXISTS` instead of overwriting ciphertext.
- Consumes: `New-SafeStatusRecord` from `.codex-safe/ProductionRolloutRunner.Core.psm1`; module import failure is `BLOCKED`.

- [ ] **Step 1: Write failing DPAPI round-trip and gate tests**

```powershell
Import-Module "$PSScriptRoot\..\LocalPreproduction.Core.psm1" -Force

Describe 'Local preproduction secret bundle' {
  It 'round-trips only through DPAPI ciphertext' {
    $path = Join-Path $TestDrive 'environment.dpapi'
    $material = New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432
    Protect-LocalPreproductionBundle -Material $material -LiteralPath $path
    $raw = Get-Content -LiteralPath $path -Raw

    $raw.Contains([string]$material.JWT_SECRET) | Should Be $false
    $raw.Contains([string]$material.POSTGRES_PASSWORD) | Should Be $false
    (Unprotect-LocalPreproductionBundle -LiteralPath $path).JWT_SECRET | Should Be $material.JWT_SECRET
  }

  It 'generates values accepted by the documented production contract' {
    $material = New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432
    ([string]$material.JWT_SECRET).Length -ge 32 | Should Be $true
    @(([string]$material.APP_KEYS).Split(',')).Count | Should Be 2
    ([Convert]::FromBase64String([string]$material.MFA_ENCRYPTION_KEY_V1)).Length | Should Be 32
    $material.NODE_ENV | Should Be 'production'
    $material.EVENT_WORKER_ENABLED | Should Be 'false'
  }

  It 'fails closed without leaking missing values' {
    $record = Test-LocalPreproductionEnvironment -Environment @{}
    $record.status | Should Be 'BLOCKED'
    ($record.alertCodes -contains 'ENV_REQUIRED_MISSING') | Should Be $true
    ($record | ConvertTo-Json -Depth 6) -match '(?i)password|postgres(?:ql)?://' | Should Be $false
  }

  It 'does not overwrite an existing secret bundle' {
    $path = Join-Path $TestDrive 'environment.dpapi'
    Set-Content -LiteralPath $path -Value 'existing-ciphertext' -NoNewline
    { Protect-LocalPreproductionBundle -Material (New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432) -LiteralPath $path } | Should Throw
    (Get-Content -LiteralPath $path -Raw) | Should Be 'existing-ciphertext'
  }
}
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
Invoke-Pester -Script '.codex-safe\tests\LocalPreproduction.Core.Tests.ps1'
```

Expected: failing import or missing-function failures; zero Docker calls.

- [ ] **Step 3: Implement secure material generation and DPAPI storage**

Implement the module with these exact rules:

```powershell
$script:RequiredApplicationKeys = @(
  'DATABASE_URL', 'JWT_SECRET', 'APP_KEYS',
  'CORS_ALLOWED_ORIGINS', 'MFA_ENCRYPTION_KEY_V1', 'NODE_ENV'
)

function New-RandomBase64([int]$ByteCount) {
  $bytes = New-Object byte[] $ByteCount
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  [Convert]::ToBase64String($bytes)
}

function New-LocalPreproductionMaterial {
  param(
    [Parameter(Mandatory)][ValidateRange(1024,65535)][int]$ApplicationPort,
    [Parameter(Mandatory)][ValidateRange(1024,65535)][int]$DatabasePort
  )
  $dbUser = 'chengyeoa_preprod'
  $dbName = 'chengyeoa_preprod'
  $dbPassword = New-RandomBase64 36
  $origin = ([UriBuilder]::new('http', '127.0.0.1', $ApplicationPort)).Uri.GetLeftPart([UriPartial]::Authority)
  $databaseUri = [UriBuilder]::new('postgresql', '127.0.0.1', $DatabasePort, $dbName)
  $databaseUri.UserName = $dbUser
  $databaseUri.Password = $dbPassword

  [ordered]@{
    POSTGRES_USER = $dbUser
    POSTGRES_PASSWORD = $dbPassword
    POSTGRES_DB = $dbName
    POSTGRES_PORT = [string]$DatabasePort
    POSTGRES_TEST_USER = 'chengyeoa_preprod_test'
    POSTGRES_TEST_PASSWORD = New-RandomBase64 36
    POSTGRES_TEST_DB = 'chengyeoa_preprod_test'
    DATABASE_URL = $databaseUri.Uri.AbsoluteUri
    JWT_SECRET = New-RandomBase64 48
    APP_KEYS = "$(New-RandomBase64 32),$(New-RandomBase64 32)"
    CORS_ALLOWED_ORIGINS = $origin
    MFA_ENCRYPTION_KEY_V1 = New-RandomBase64 32
    NODE_ENV = 'production'
    EVENT_WORKER_ENABLED = 'false'
    HOST = '127.0.0.1'
    PORT = [string]$ApplicationPort
  }
}
```

Serialize the material to UTF-8 JSON in memory, protect it with `[System.Security.Cryptography.ProtectedData]::Protect(..., CurrentUser)`, and write only Base64 ciphertext to `%LOCALAPPDATA%\ChengyeOA\local-preproduction\environment.dpapi`. Use UTF-8 bytes for the fixed, non-secret entropy label `ChengyeOA.LocalPreproduction.v1`. Create the parent directory with an ACL containing only the current Windows user and `SYSTEM` before writing.

Validation must check key presence, exact production mode, exact Worker-disabled value, two APP keys of at least 24 characters, canonical 32-byte MFA Base64, loopback origin, and absence of known sample markers. It must never attach rejected values to exceptions or output.

Implement `New-ChengyeOALocalPreproductionBundle.ps1` as the only initial creation entry point. It resolves the fixed storage root, calls `New-LocalPreproductionMaterial -ApplicationPort 7001 -DatabasePort 55432`, and protects the result. If `environment.dpapi` already exists, it returns `BLOCKED` with `SECRET_BUNDLE_ALREADY_EXISTS`; it has no overwrite or rotation switch.

- [ ] **Step 4: Implement source/portable snapshot comparison**

Compare only these fields: `status`, `undispatched`, `dueBacklog`, `manual`, `processing`, `expiredProcessing`, `staleExpiredProcessing`, and `leaseLost15m`. Return `READY` only when both summaries are `READY` and every listed count is identical; otherwise return `BLOCKED` with `PREFLIGHT_SNAPSHOT_MISMATCH`.

- [ ] **Step 5: Run core tests GREEN**

Run:

```powershell
Invoke-Pester -Script '.codex-safe\tests\LocalPreproduction.Core.Tests.ps1'
```

Expected: all tests pass; test output contains no generated secret.

- [ ] **Step 6: Record safe checkpoint**

Record only test count, failure count, alert codes, UTC start/end, and elapsed seconds. Do not stage or commit files.

### Task 2: Process-Scoped Loader and Pinned Toolchain

**Files:**
- Create: `.codex-safe/Load-ChengyeOALocalPreproduction.ps1`
- Modify: `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`

**Interfaces:**
- Consumes: `Unprotect-LocalPreproductionBundle`, `Test-LocalPreproductionEnvironment`.
- Produces: process environment with the validated application and Compose keys.
- Produces: one safe JSON record named `local_preproduction_environment_load`.

- [ ] **Step 1: Write failing loader tests**

Test these behaviors in a child PowerShell process using a temporary DPAPI bundle:

1. Missing bundle returns `BLOCKED` and `SECRET_BUNDLE_MISSING`.
2. Invalid ciphertext returns `BLOCKED` and `SECRET_BUNDLE_INVALID` without a stack.
3. Successful load sets all required variables only in the child process.
4. Toolchain mismatch returns `BLOCKED`.
5. Serialized output contains no environment value, filesystem secret path, or connection-string scheme.

- [ ] **Step 2: Run loader tests RED**

```powershell
Invoke-Pester -Script '.codex-safe\tests\LocalPreproduction.Workflow.Tests.ps1'
```

Expected: missing loader or missing behavior failures.

- [ ] **Step 3: Implement direct pinned PATH activation**

The loader must:

1. Set the project directory to `LayerManage\law-firm-system` relative to `$PSScriptRoot`.
2. Use the available `npx.cmd` only to resolve `node@22.14.0` and `npm@10.9.2`.
3. Take `process.execPath` as the Node executable, locate exactly one matching `npm.cmd` directory from the captured child PATH, and prepend both directories to the current process PATH.
4. Recheck exact outputs `v22.14.0` and `10.9.2` without printing either raw command output.
5. Return `TOOLCHAIN_VERSION_MISMATCH` on any ambiguity or mismatch.

- [ ] **Step 4: Import only allow-listed variables**

Use this explicit allow list:

```powershell
$allowed = @(
  'POSTGRES_USER','POSTGRES_PASSWORD','POSTGRES_DB','POSTGRES_PORT',
  'POSTGRES_TEST_USER','POSTGRES_TEST_PASSWORD','POSTGRES_TEST_DB',
  'DATABASE_URL','JWT_SECRET','APP_KEYS','CORS_ALLOWED_ORIGINS',
  'MFA_ENCRYPTION_KEY_V1','NODE_ENV','EVENT_WORKER_ENABLED','HOST','PORT'
)
```

Assign with `[Environment]::SetEnvironmentVariable($name, [string]$bundle[$name], 'Process')`. Force `EVENT_WORKER_ENABLED` back to `false` after import. Do not support Machine/User scope or a remote toggle.

- [ ] **Step 5: Run loader tests GREEN**

```powershell
Invoke-Pester -Script '.codex-safe\tests\LocalPreproduction.Workflow.Tests.ps1'
```

Expected: all tests pass and the parent test process remains unchanged.

- [ ] **Step 6: Record safe checkpoint**

Record only Boolean toolchain/environment results and test counts. Do not output resolved executable paths or the secret bundle path.

### Task 3: Guarded Empty PostgreSQL Reinitialization

**Files:**
- Modify: `.codex-safe/LocalPreproduction.Core.psm1`
- Create: `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1`
- Modify: `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`

**Interfaces:**
- Produces: `Get-LocalPreproductionComposeTarget -ComposePath <string> -> object` with project path, service count, and volume count but no container identifier.
- Produces: `Invoke-LocalPreproductionNative -FilePath <string> -Arguments <string[]> -> sanitized result` with injected test override.
- Consumes: the process environment loaded in Task 2.

- [ ] **Step 1: Write failing target and destructive-guard tests**

Cover:

1. Compose path outside the trusted project is rejected.
2. Anything other than service `postgres` and exactly one named volume `chengye_postgres_data` is rejected.
3. Missing `-ConfirmEmptyDatabaseReset` never calls `docker compose down --volumes`.
4. A nonzero application-table count returns `BLOCKED` with `DATABASE_NOT_EMPTY`.
5. Native stderr is discarded from user output and mapped to a stable alert code.
6. No Docker command uses a container identifier or global prune operation.

- [ ] **Step 2: Run workflow tests RED**

```powershell
Invoke-Pester -Script '.codex-safe\tests\LocalPreproduction.Workflow.Tests.ps1'
```

Expected: failures for missing target resolver and initializer.

- [ ] **Step 3: Implement fail-closed target resolution**

Resolve the canonical Compose path to:

```text
LayerManage/law-firm-system/infra/postgres/compose.yml
```

Call only metadata forms of Compose (`config --services` and `config --volumes`), capture output in memory, and require service `postgres` plus exactly one named volume, `chengye_postgres_data`. Never call `docker ps`, never log Compose-resolved environment, and never accept a caller-supplied service or volume name.

- [ ] **Step 4: Verify emptiness without printing database output**

Execute a fixed SQL count inside the Compose database service. Capture the single integer result, require zero user application tables before reset, and map all other outcomes to `DATABASE_EMPTY_CHECK_FAILED`. Discard raw database stderr.

- [ ] **Step 5: Reinitialize only the verified target**

The initializer must require all of:

- `-ConfirmEmptyDatabaseReset` switch;
- valid DPAPI bundle;
- production environment gate `READY`;
- Worker disabled;
- exact Compose metadata;
- empty-table count of zero.

Then invoke only:

```powershell
docker compose -f $composePath down --volumes
docker compose -f $composePath up -d
```

Poll the service health with bounded retries no longer than two minutes. Return safe counts and `DATABASE_HEALTH_TIMEOUT` on timeout. Do not display service names, ports, container details, or raw errors.

- [ ] **Step 6: Run workflow tests GREEN**

```powershell
Invoke-Pester -Script '.codex-safe\tests\LocalPreproduction.Workflow.Tests.ps1'
```

Expected: destructive calls occur only in the fully approved zero-table test case.

- [ ] **Step 7: Record reset-ready checkpoint**

Do not run the live reset yet. Record that tests authorize exactly one scoped destructive operation.

### Task 4: Migration and Hidden Administrator Bootstrap

**Files:**
- Modify: `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1`
- Modify: `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`

**Interfaces:**
- Consumes: verified database health from Task 3.
- Produces: safe state progression `DATABASE_READY -> MIGRATED -> BOOTSTRAP_CONTRACT_READY -> ADMIN_BOOTSTRAPPED`.

- [ ] **Step 1: Write failing state-order tests**

Assert the exact command order:

1. `npm.cmd run db:assert-empty`
2. `npm.cmd run db:deploy`
3. `npm.cmd run check:bootstrap`
4. `npm.cmd run system:bootstrap`

Any nonzero exit must stop later commands. The system bootstrap command must inherit the console for hidden input and must not receive a password argument or redirected stdin.

- [ ] **Step 2: Run state-order tests RED**

```powershell
Invoke-Pester -Script '.codex-safe\tests\LocalPreproduction.Workflow.Tests.ps1'
```

- [ ] **Step 3: Implement migration orchestration**

Run from `LayerManage\law-firm-system` with the current process environment. Capture and sanitize noninteractive command output through `Invoke-SafeNativeCommand`. Treat any nonzero result as `BLOCKED`, using stable codes `DATABASE_NOT_EMPTY`, `MIGRATION_FAILED`, and `BOOTSTRAP_CONTRACT_FAILED` without relaying raw output.

- [ ] **Step 4: Implement the interactive bootstrap boundary**

Before `npm.cmd run system:bootstrap`, write one safe `WAITING_OPERATOR_SECRET_INPUT` record. Invoke it directly in the same console so the repository's hidden prompt owns password entry. After it exits, record only success/failure and elapsed time. Never inspect PowerShell history or capture the prompt stream.

- [ ] **Step 5: Run workflow tests GREEN**

```powershell
Invoke-Pester -Script '.codex-safe\tests\LocalPreproduction.Workflow.Tests.ps1'
```

Expected: strict order, fail-closed transitions, no password channel except inherited console.

#### Task 4 safe-interaction revision (2026-07-27)

The inherited-console administrator boundary must invoke the server package's explicit
`--safe-interactive` bootstrap mode through a silent package-manager call. In that mode,
all operator-provided values use hidden input with fixed safe labels; the CLI emits no
database-location metadata, ordinary completion text, or ordinary error text. The wrapper
continues to emit only the approved safe waiting and final status records. The default
bootstrap CLI mode remains compatible for separately invoked non-local-preproduction use.

- [ ] **Step 6: Execute the approved live initialization**

In the same PowerShell that holds the pinned PATH:

```powershell
& '.\.codex-safe\New-ChengyeOALocalPreproductionBundle.ps1'
. '.\.codex-safe\Load-ChengyeOALocalPreproduction.ps1'
& '.\.codex-safe\Initialize-ChengyeOALocalPreproduction.ps1' -ConfirmEmptyDatabaseReset
```

Run bundle creation only when the fixed bundle does not already exist. Expected: safe phase records only. The operator enters and confirms the temporary administrator password when prompted. Stop on any non-`READY` phase.

### Task 5: Restricted Backup and Recovery Unit

**Files:**
- Modify: `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1`
- Modify: `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`

**Interfaces:**
- Consumes: `ADMIN_BOOTSTRAPPED` state.
- Produces: a custom-format PostgreSQL backup in the same ACL-restricted local-preproduction storage root as the DPAPI bundle.
- Produces: safe backup evidence containing existence, nonzero-size Boolean, verification Boolean, UTC, and elapsed time only.

- [ ] **Step 1: Write failing backup tests**

Test that:

1. backup is never attempted before bootstrap success;
2. destination resolves under the fixed local-preproduction storage root;
3. backup filenames contain only a UTC timestamp and fixed prefix;
4. `pg_restore --list` verification is required;
5. failure output is replaced with `BACKUP_CREATE_FAILED` or `BACKUP_VERIFY_FAILED`;
6. no backup path or database setting is printed.

- [ ] **Step 2: Run backup tests RED**

```powershell
Invoke-Pester -Script '.codex-safe\tests\LocalPreproduction.Workflow.Tests.ps1'
```

- [ ] **Step 3: Implement backup inside the database service**

Use service `postgres`, never a container identifier. Create a custom-format dump at `/tmp/chengyeoa-local-preproduction.dump`, verify it there with `pg_restore --list`, then copy it with `docker compose cp` into `%LOCALAPPDATA%\ChengyeOA\local-preproduction\backups`. Build the filename as `'chengyeoa-preprod-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '.dump'`, and validate nonzero host file length. Never stream the binary dump through PowerShell text redirection.

- [ ] **Step 4: Run backup tests GREEN**

```powershell
Invoke-Pester -Script '.codex-safe\tests\LocalPreproduction.Workflow.Tests.ps1'
```

- [ ] **Step 5: Verify live backup safely**

Expected safe result: backup existence `1`, nonzero-size `1`, verification `1`. Do not display the filename or directory.

### Task 6: Local Runtime and Source/Portable Preflight Agreement

**Files:**
- Create: `.codex-safe/Invoke-ChengyeOALocalPreproductionPreflight.ps1`
- Modify: `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`

**Interfaces:**
- Consumes: loaded environment, verified backup evidence, existing portable executable, `ConvertFrom-EventCheckSummary`, and `Compare-EventPreflightSnapshot`.
- Produces: safe runtime/listener record and final preflight agreement record.

- [ ] **Step 1: Write failing runtime/preflight tests**

Cover:

1. missing backup evidence blocks launch;
2. missing portable executable blocks launch;
3. Worker not exactly disabled blocks launch;
4. a listener bound outside loopback causes immediate process termination and `NON_LOOPBACK_BINDING`;
5. source preflight runs before portable preflight;
6. snapshot mismatch returns `PREFLIGHT_SNAPSHOT_MISMATCH`;
7. no governance event, drain, Worker enablement, or canary command is invoked.

- [ ] **Step 2: Run runtime/preflight tests RED**

```powershell
Invoke-Pester -Script '.codex-safe\tests\LocalPreproduction.Workflow.Tests.ps1'
```

- [ ] **Step 3: Implement hidden local portable launch**

Launch the existing executable with `Start-Process -WindowStyle Hidden -PassThru`, retain its process object only in memory, and never serialize its identifier. Poll health for at most two minutes. Inspect the listener for the configured port and require every binding to be loopback; otherwise stop the process and return `BLOCKED`.

- [ ] **Step 4: Implement exact preflight commands**

From the project root, invoke:

```powershell
npm.cmd --prefix apps/server run events:check -- --mode=preflight
```

Then invoke the portable executable with arguments:

```text
events:check --mode=preflight
```

Parse both through the existing safe Event Center converter. Compare the durable snapshot fields from Task 1. Do not use age counters or evaluation timestamps for equality.

- [ ] **Step 5: Run all PowerShell tests GREEN**

```powershell
Invoke-Pester -Script @(
  '.codex-safe\tests\LocalPreproduction.Core.Tests.ps1',
  '.codex-safe\tests\LocalPreproduction.Workflow.Tests.ps1'
)
```

Expected: zero failures and no secret-pattern matches in captured output.

- [ ] **Step 6: Execute live preflight**

```powershell
& '.\.codex-safe\Invoke-ChengyeOALocalPreproductionPreflight.ps1'
```

Expected: runtime/listener `READY`, source `READY`, portable `READY`, snapshot agreement `READY`. Stop the runtime on any other result.

### Task 7: Final Verification and Handoff

**Files:**
- Create: `.codex-safe/local-preproduction-status.md`.
- Test: `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1`
- Test: `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1`

**Interfaces:**
- Consumes: fresh outputs from Tasks 1–6.
- Produces: a safe handoff that explicitly says local preproduction and Worker disabled.

- [ ] **Step 1: Run the full fresh verification set**

```powershell
Invoke-Pester -Script @(
  '.codex-safe\tests\LocalPreproduction.Core.Tests.ps1',
  '.codex-safe\tests\LocalPreproduction.Workflow.Tests.ps1'
)

Set-Location '.\LayerManage\law-firm-system'
npm.cmd run check:bootstrap
npm.cmd run security:audit:prod
```

Run source and portable preflight again against the unchanged snapshot. Do not reuse earlier output.

- [ ] **Step 2: Scan safe artifacts for forbidden content**

Scan only newly created status/test artifacts for connection-string schemes, credential-key assignments, URL literals, stack markers, container/process identifiers, worker identifiers, and lock-owner fields. Any match is `BLOCKED` until removed from the artifact and regenerated safely.

- [ ] **Step 3: Confirm final bounded evidence**

Require these Booleans/counts:

- pinned Node/npm checks: both `1`;
- environment required-present count: `6/6`;
- production mode: `1`;
- Worker disabled: `1`;
- database health: `1`;
- migrations: `1`;
- bootstrap contract: `1`;
- administrator bootstrap: `1`;
- backup create/verify: both `1`;
- loopback-only listener: `1`;
- source/portable preflight agreement: `1`;
- forbidden-output matches: `0`.

- [ ] **Step 4: Write the handoff**

State only classification, phase statuses, bounded counts, alert codes, UTC start/end, and elapsed time. Explicitly state:

- this is local preproduction, not online production;
- Worker remains disabled;
- no governance event/drain/canary has run;
- final online deployment still needs provider, hostname, certificate, routing, backup destination, monitoring, and approved online secrets;
- if this database is promoted, the backup and matching MFA encryption key must move together.

- [ ] **Step 5: Stop at the approved boundary**

Do not enable the Worker and do not begin the Event Center governance/drain/canary rollout from this plan. That requires the reliable Event Center rollout runbook and a separate explicit authorization for this initialized environment.

## Addendum (2026-07-27): Isolated Compose Project

The default Compose project was discovered nonempty, and deletion was blocked. All subsequent local-preproduction initialization uses the fixed isolated Compose project.
