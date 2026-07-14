# SQLite Audit and PostgreSQL Baseline Runbook

## Status

- SPEC: `SPEC-001 Engineering Baseline and PostgreSQL Migration`
- Audit gate: `REJECT_AND_INVESTIGATE` (closed)
- Replacement decision: `CLEAN_POSTGRESQL_BASELINE_APPROVED`
- Decision date: `2026-07-14`
- Reviewer: project owner
- Plan state: original Plan stopped at Task 9; revised Plan is `docs/superpowers/plans/2026-07-14-empty-postgresql-baseline-implementation.md`

## Source Audit

Audit run ID: `spec001-real-audit-20260713-224926`

| Source | Intended role | SHA-256 |
|---|---|---|
| `LayerManage/law-firm-system/apps/server/prisma/law_firm.db` | Candidate primary | `B61917FFA7823F15CA9F9A20EB95463B28F0A7AB161108338FFBE068CAD48E11` |
| `LayerManage/law-firm-system/prisma/law_firm.db` | Secondary evidence | `9A8F3EED9B429190643CE1A55F11F61A2B3DD4329C28DA3E4F6182F93A8C629C` |

The original hashes were unchanged after the audit. No WAL, SHM, rollback-journal, or super-journal sidecar was present. Inventory and diff commands operated only on read-only copies.

The reviewed diff report SHA-256 was:

`841071C370E41CC32B4FA71F9F1B8BACA6AE76A039B7B2CDC7A6AD9A42F39ACF`

Generated reports and full-fidelity exports remain under the Git-ignored runtime directory `LayerManage/law-firm-system/var/migration/spec001-real-audit-20260713-224926*` and must not be committed.

## Audit Summary

| Metric | Result |
|---|---:|
| Candidate-primary records | 16 |
| Secondary records | 20 |
| `PRIMARY_ONLY` | 15 |
| `SECONDARY_ONLY` | 19 |
| `CONTENT_MISMATCH` | 0 |
| `BUSINESS_KEY_COLLISION` | 1 |

The sole business-key collision is on `User.username`. The report contains no same-ID content mismatch.

Git-history comparison established that the candidate-primary table counts exactly match the legacy canonical demo seed, including its sample lead-to-case business chain. The secondary stable IDs, eleven permissions, system records, and two channels exactly match the former duplicate seed. Both SQLite files therefore represent legacy demo/initialization datasets rather than confirmed law-firm operating history.

## Gate Decision

Decision: `REJECT_AND_INVESTIGATE`.

Required effects:

1. Do not import either SQLite dataset into PostgreSQL.
2. Do not merge secondary-only records into the candidate primary.
3. Do not delete, rewrite, checkpoint, or otherwise modify either SQLite source.
4. Keep the original PostgreSQL migration Tasks 10-14 blocked.
5. Do not treat the reviewed diff hash as approval for a later import.

## Replacement Decision

The project owner confirmed that the SQLite databases contain no valuable operating data and approved a clean PostgreSQL baseline.

Required effects:

1. PostgreSQL receives only committed Prisma schema migrations.
2. Do not run a system seed or create organizations, users, roles, permissions, channels, or business records.
3. All application tables must contain zero rows after baseline initialization; `_prisma_migrations` is the only allowed metadata exception.
4. Retain only the read-only `migration:inventory` and `migration:diff` capabilities.
5. Remove the `migration:import`, `migration:validate`, and `db:seed` active command surfaces through the revised implementation Plan.
6. Keep both SQLite files unchanged and outside Git as historical evidence; they are not a runtime fallback.
7. Define first-organization and first-administrator creation in a later dedicated Spec.

## Future Source Discovery

If a different source containing real operating data is discovered later, do not reuse this audit as import approval. Create a new Spec, new read-only copies, new source hashes, and a new explicit human decision before adding any import capability.

## Prohibited Commands

Do not run `migration:import`, `migration:validate`, or `db:seed`. Do not remove or modify either SQLite source. Do not execute the original Tasks 10-14; follow only `docs/superpowers/plans/2026-07-14-empty-postgresql-baseline-implementation.md` after selecting an execution mode.
