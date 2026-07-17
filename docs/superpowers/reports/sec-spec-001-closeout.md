# SEC-SPEC-001 Dependency Security Closeout

## Status

SEC-SPEC-001 is locally implemented and accepted on branch `codex/spec-003-dependency-security`. The measured implementation baseline is commit `f523c4b7c22fd983e99511c1d86cd13d90cbeadd`, using Node.js `22.14.0` and npm `10.9.2`. Remote GitHub Actions execution remains pending and is not recorded as passed.

## Security Outcome

| Workspace and scope | 2026-07-16 baseline | Final result | Gate |
| --- | --- | --- | --- |
| Server production | low 0, moderate 7, high 7, critical 0, total 14 | low 0, moderate 1, high 0, critical 0, total 1 | Pass |
| Server full tree | low 2, moderate 13, high 8, critical 0, total 23 | production: moderate 1; development: moderate 1, high 1; critical 0; total 3 | Pass with exact development exception |
| Web production | low 0, moderate 0, high 4, critical 0, total 4 | all severities 0 | Pass |
| Web full tree | low 1, moderate 1, high 5, critical 0, total 7 | development: low 1, moderate 1; high 0, critical 0, total 2 | Pass |

Both production workspaces have zero `critical` and zero `high` findings. Both complete dependency trees have zero `critical` findings.

## Remediation Record

- Web runtime dependencies were raised to `axios 1.18.1`, `react-router-dom 7.18.1`, and `form-data 4.0.6`; Vite was raised to `8.1.4`.
- Server runtime was raised to Egg `3.34.0`, `egg-scripts 3.1.0`, `jsonwebtoken 9.0.3`, and `egg-cors 3.0.1`; the unused `egg-jwt` dependency and plugin were removed.
- The `urllib 3.27.3` dependency paths are constrained to `undici 6.27.0`; the separate `urllib 4` path remains on its compatible newer `undici` line.
- Credentialed CORS now reflects only normalized configured origins. Development defaults to the local web origin; production refuses startup without an explicit origin list. Wildcards, credentials in origins, non-HTTP protocols, paths, queries, and fragments are rejected.

## Residual Exception

`SEC-2026-001` covers only the server development dependency `serialize-javascript` advisory `GHSA-5c6j-r48x-rmvq`. It expires on `2026-08-15`, has separate owner and approving roles, and cannot cover another package, advisory, workspace, scope, or date. Production exceptions and development `critical` exceptions remain forbidden.

## Acceptance Evidence

The following commands completed with exit code `0` after clean installation of all three lockfiles:

```text
npm ci
npm --prefix apps/server ci
npm --prefix apps/web ci
npm --prefix apps/server run db:generate
npm run security:policy:validate
npm run security:test
npm run security:audit:prod
npm run security:audit:all
npm run security:sbom
npm run verify
```

The final verification passed `359/359` server tests, `23/23` web tests, and `30/30` dependency-security tests. Baseline and bootstrap contracts passed, and server and web production builds completed. PostgreSQL acceptance reset `chengye_oa_test`, confirmed all application tables empty before verification, reset it again afterward, and confirmed all application tables empty.

The web build retains a non-blocking chunk-size warning for the approximately 1.74 MB minified main bundle. Existing React Hook lint warnings also remain non-blocking; neither changes the security gates recorded here.

## Generated Evidence

Evidence is generated locally under ignored `var/security` paths and is never committed:

- `var/security/audit/production-summary.json`
- `var/security/audit/full-summary.json`
- `var/security/sbom/server.cdx.json` (CycloneDX 1.5, 950 components)
- `var/security/sbom/web.cdx.json` (CycloneDX 1.5, 360 components)

The SBOMs contain commit, workspace, Node.js, npm, and generation-time traceability properties. Artifact safety tests and the final sensitive-value scan found no committed credentials or local audit exports.

## Remaining Release Gate

The independent `dependency-security` GitHub Actions job has been defined and contract-tested, but no remote run was observed during local closeout. Merge and release remain blocked until that job succeeds and uploads the expected 14-day dependency-security evidence artifact.
