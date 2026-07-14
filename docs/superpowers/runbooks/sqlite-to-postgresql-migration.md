# SQLite to PostgreSQL Migration Runbook

## Status

- SPEC: `SPEC-001 Engineering Baseline and PostgreSQL Migration`
- Current gate: `REJECT_AND_INVESTIGATE`
- Decision date: `2026-07-14`
- Reviewer: project owner
- Plan state: stopped at Task 9; Tasks 10-14 must not start without a new approved source decision

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
4. Keep PostgreSQL migration Tasks 10-14 blocked.
5. Do not treat the reviewed diff hash as approval for a later import.

## Reopening Conditions

A new migration gate may be opened only after all applicable items are resolved:

1. Confirm whether any real operating data exists in another database, backup, export, or deployed environment.
2. If no real operating data exists, revise SPEC-001 and its implementation Plan to use a clean PostgreSQL database plus the system-only seed, with no SQLite import.
3. Verify that the system seed cannot overwrite or rewire migrated users, employees, organizations, roles, or permissions when matching records already exist.
4. If another source is found, create new read-only copies, recompute source hashes, generate a new inventory/diff run, and obtain a new explicit human gate decision.
5. Record the replacement decision and evidence here before any import command is allowed.

## Prohibited Commands

Until a replacement decision is approved, do not run `migration:import`, remove either SQLite source, or start the PostgreSQL cutover rehearsal.
