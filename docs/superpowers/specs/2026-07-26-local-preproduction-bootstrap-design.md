# ChengyeOA Local Preproduction Bootstrap Design

Date: 2026-07-26
Status: Approved design, pending implementation plan

## Purpose

Establish the current Windows host and its empty PostgreSQL container as a local preproduction environment for ChengyeOA. The environment must exercise production runtime behavior without being represented as the final online production deployment.

This design does not restore historical production data and does not authorize publishing the application to a public or remote network.

## Environment Classification

- Deployment classification: local preproduction.
- Runtime mode: `NODE_ENV=production`.
- Initial Event Center worker state: disabled.
- Network exposure: loopback only.
- Database state: disposable and empty before initialization.
- Future online production: a separate deployment with its own approved secret set and recovery controls.

## Components

### Encrypted secret bundle

Generate new database and application secrets with a cryptographically secure random generator. Protect the bundle with Windows DPAPI for the current Windows user and store it outside the source repository. No plaintext production-style `.env` file is created.

The bundle contains the database bootstrap settings and the application settings required by the deployment contract. Secret values must never be written to logs, command output, handoff documents, or source files.

### Environment loader

Create a PowerShell loader containing no secret values. It decrypts the DPAPI bundle into the current process, validates required variables without displaying values, forces the Event Center worker off, and emits only safe status fields: phase, status, bounded counts, alert codes, UTC timestamps, and elapsed time.

The loader is process-scoped. Closing PowerShell removes the loaded environment; reopening PowerShell requires loading it again and reactivating the pinned Node/npm path.

### PostgreSQL bootstrap

The existing database is empty. Stop only the Compose project defined by the ChengyeOA PostgreSQL configuration, resolve and verify its exact named volume, then delete and recreate that volume once so the database is initialized with newly generated credentials instead of repository defaults.

No broad Docker cleanup or unrelated container/volume operation is permitted.

### Application initialization

After the database is healthy:

1. Verify pinned Node 22.14.0 and npm 10.9.2.
2. Load and validate the process-scoped environment.
3. Run the empty-database assertion before initialization.
4. Apply canonical database migrations.
5. Run the repository bootstrap contract checks.
6. Run `system:bootstrap` to create the first super administrator.

The operator enters the temporary administrator password only through the command's hidden interactive prompt. The password is never accepted through chat, command history, a command-line argument, or a file. The first-login forced password change remains mandatory.

### Local runtime

Start the synchronized Server/Web build in production mode and bind it to loopback. Determine the login endpoint only after confirming the actual listener and health checks. Do not publish the service to a LAN or the internet during this bootstrap.

## Event Center Safety

- The worker remains disabled through database initialization, migration, bootstrap, and initial preflight.
- Source and portable preflight must evaluate the same initialized database snapshot and reach the same conclusion.
- A `BLOCKED` result stops the procedure immediately.
- A `DEGRADED` result extends observation and requires investigation before any worker activation.
- Worker activation, governance events, drain operations, and canary execution are outside the initial bootstrap and require the rollout runbook gates.
- No production-style event history may be deleted, skipped, rewritten, or repaired manually.
- No remote worker toggle is introduced.

## Failure Handling and Recovery

Before database initialization, record a safe inventory and confirm that the target database contains no required data. After migrations and bootstrap, create a database backup and retain the matching DPAPI-protected secret bundle as one recovery unit.

If initialization fails before bootstrap completes, stop the application and worker, preserve safe diagnostics, and either correct the specific failure or recreate only the verified disposable database volume. If failure occurs after bootstrap, restore the backup and its matching secret bundle rather than regenerating encryption keys against retained data.

## Verification

Successful bootstrap requires all of the following:

- pinned Node/npm check is `READY`;
- production-mode environment Boolean gate is `READY`;
- worker-disabled gate is `READY`;
- PostgreSQL health check succeeds;
- empty-database assertion succeeds before migration;
- canonical migrations succeed;
- bootstrap contract checks succeed;
- first super administrator is created through hidden input;
- synchronized Server/Web runtime passes local health checks;
- source and portable Event Center preflight results agree;
- logs contain only permitted safe fields.

No completion claim may be made from an earlier or partial result.

## Future Online Deployment

The final online environment receives a separately approved secret set. If no preproduction data is retained, initialize the online database independently. If the local database is promoted, migrate the database backup together with every data-dependent encryption key, especially the MFA encryption key, and validate restoration before exposing traffic.

Online hostnames, certificates, public routing, external backups, monitoring destinations, and deployment-provider configuration are deliberately excluded from this local bootstrap.
