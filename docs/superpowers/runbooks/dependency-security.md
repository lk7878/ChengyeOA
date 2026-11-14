# Dependency Security Operations

This runbook governs npm dependency audits, development exceptions, and CycloneDX SBOM evidence for Chengye OA. Run commands from `LayerManage/law-firm-system` with Node.js `22.14.0` and npm `10.9.2`.

## Safety Rules

- Use the three committed lockfiles and a clean reviewed branch. Do not hand-edit lockfiles.
- Never run `npm audit fix --force`. Automated repair can downgrade Egg tooling, cross compatibility boundaries, or change authentication and packaging behavior without evidence.
- Never add a production exception. Production `critical` and `high` findings must remain zero.
- Development `critical` findings always block. A development `high` finding may pass only through one exact, approved, unexpired record.
- Do not commit `var/security`, raw npm audit JSON, environment files, credentials, database URLs, tokens, local paths, or generated distributions.
- Online audit failure is not a clean result. Registry errors, malformed output, unsupported schemas, and incomplete workspace scans fail closed.

## Commands

The root scripts are portable and are the authoritative interface:

```powershell
npm.cmd run security:policy:validate
npm.cmd run security:audit:prod
npm.cmd run security:audit:all
npm.cmd run security:sbom
```

| Command | Purpose |
| --- | --- |
| `security:policy:validate` | Offline validation of policy and exception structure, dates, approval separation, and workspace definitions. |
| `security:audit:prod` | Online server and web production audit; blocks any production `critical` or `high`. |
| `security:audit:all` | Online complete-tree audit; blocks all `critical` and every unapproved development `high`. |
| `security:sbom` | Generates separate server and web CycloneDX 1.5 JSON documents from the committed lockfiles. |

`npm run verify` includes `security:test` and the offline policy validation, but not online audits or SBOM generation. This keeps local verification deterministic when the npm registry is unavailable. The independent CI `dependency-security` job performs online audits and always attempts SBOM generation and evidence upload.

## Artifacts

Generated evidence is ignored by Git:

- `var/security/audit/production-summary.json`
- `var/security/audit/full-summary.json`
- `var/security/sbom/server.cdx.json`
- `var/security/sbom/web.cdx.json`

Audit summaries contain only normalized package, advisory, severity, scope, counts, and execution metadata. SBOMs must report CycloneDX 1.5 and include `chengye.commit`, `chengye.workspace`, `chengye.node`, `chengye.npm`, and `chengye.generatedAt` properties. CI uploads `dependency-security-${{ github.sha }}` for 14 days.

## Exception Workflow

Exceptions live in `security/dependency-exceptions.json`. Add one only after a compatible update has been attempted, the finding is proven development-only, and production audit remains clean.

1. Identify the exact workspace, package, and GHSA or npm advisory from the sanitized full summary.
2. Record the reason no compatible upstream release is available and the concrete mitigation that excludes the package from production runtime artifacts.
3. Assign an owner and a different approving role. Self-approval is invalid.
4. Set `createdAt`, `expiresAt`, and `trackingRef`. The maximum lifetime is 30 calendar days; wildcard packages, wildcard advisories, production scope, and automatic renewal are forbidden.
5. Run `security:policy:validate`, `security:test`, `security:audit:prod`, and `security:audit:all` before review.

Remove the record as soon as the advisory no longer appears. Before expiry, the owner must upgrade or replace the dependency and rerun the full acceptance. An extension requires a new independent review and may never be implemented by silently changing only the date.

## Failure Triage

1. Preserve the exit code and sanitized one-line diagnostic. Do not commit or paste raw audit output into a ticket.
2. For registry, timeout, authentication, rate-limit, malformed JSON, or unsupported-schema errors, verify network and registry status, then rerun the unchanged command. Never reinterpret an unavailable scan as zero risk.
3. For a new production `critical/high` or development `critical`, stop release work and open a reviewed remediation change.
4. For a new development `high`, first attempt a compatible direct or transitive upgrade and run full regression. Do not copy an existing exception by package name alone.
5. After any dependency change, run lint, typecheck, tests, build, package verification, both audits, and SBOM generation. Confirm generated evidence contains no secrets or local absolute paths.

The current initial exception is `SEC-2026-001` for server development-only `serialize-javascript` advisory `GHSA-5c6j-r48x-rmvq`, expiring `2026-08-15`. Its presence does not permit any other package, advisory, workspace, scope, or date.
