# Organization and Personnel Master Data Operations

This runbook covers SPEC-003 organization, position, employee assignment, professional-team, and account-binding operations. It does not replace SPEC-004 RBAC or SPEC-005 administrator review. Until those Specs are accepted, every master-data API requires a currently enabled database-backed `SYSTEM_SUPER_ADMIN` role.

## Safety and Prerequisites

- Use the reviewed release, Node.js `22.14.0`, npm `10.9.2`, PostgreSQL 16, and the approved runtime secrets.
- Take a PostgreSQL backup or storage snapshot before production migration, organization-tree repair, or bulk master-data maintenance. Verify the restore procedure in `postgresql-backup-restore.md`.
- Never run `db:reset:test`, the SPEC-003 E2E fixture, or the migration rehearsal against production. Their database guards are test-only safety controls, not production tools.
- Do not physically delete organization, position, employee, assignment, team, or membership records. Use disable, end, transfer, formalize, or leave actions so history remains intact.
- Do not edit materialized paths, assignment history, versions, trust-root rows, or audit rows directly in PostgreSQL.
- Keep names, phone numbers, email addresses, identity numbers, license numbers, tokens, and free-text fields out of tickets and shared logs.

Run project commands from `LayerManage/law-firm-system` through the pinned toolchain:

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run <script>
```

## Migration Procedure

1. Confirm the reviewed commit, backup, maintenance window, target database, and rollback owner.
2. Load the approved environment without printing `DATABASE_URL`, `JWT_SECRET`, or `APP_KEYS`.
3. Check migration state, then deploy the reviewed migrations:

```powershell
Push-Location apps\server
try { npx.cmd prisma migrate status } finally { Pop-Location }
npm.cmd run db:deploy
```

4. Confirm the expand migration created paths and assignment history before the contract migration removed legacy employee ownership columns.
5. Start the application and verify health, root organization, first-super-admin access, and representative organization and employee reads.

For local migration acceptance only, the reviewed rehearsal creates and removes the fixed disposable database `chengye_oa_spec003_migration_test`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File apps/server/scripts/db/rehearse-spec-003-migration.ps1
```

The command must end with both `SPEC-003 migration rehearsal passed.` and a successful disposable-database drop.

## Initial Setup Order

1. Keep the SPEC-002 root organization as the only `FIRM`; rename it when needed, but do not move or disable it.
2. Under the root, create head-office centers such as the Forward-Looking Research Department, Lawyer Training Department, and Brand Communications Department as `HQ_CENTER` nodes.
3. Create regional offices as `BRANCH` nodes under the root.
4. Create administrative departments and groups only under parent types allowed by the hierarchy policy.
5. Create positions inside their owning organization. Position codes are stable within that organization and cannot be reassigned to another organization.
6. Create employees with one active primary assignment. Add secondary or acting assignments only after the primary relationship is valid.
7. Create cross-office professional teams after employees exist. Team categories remain open for future categories beyond the initial professional teams.
8. Bind login accounts only after the employee record is correct. Binding the initialized first super-admin must preserve its user ID, role, credential state, and trust-root identity.

## Organization Changes

### Move

- Supply the current `version`; stale updates return `VERSION_CONFLICT` and make no writes.
- Never move the root, move a node below its own descendant, or create an invalid parent/type combination.
- A successful move updates the target and every descendant path and version in one transaction.
- After a move, verify the target parent, subtree paths, levels, and representative employee organization projections.

### Disable and Enable

- An organization cannot be disabled while it has enabled descendants, enabled positions, or active assignments.
- Disable dependent relationships from the leaves upward: end or transfer assignments, disable positions, then disable child organizations before their parent.
- An organization cannot be enabled below a disabled ancestor. Enable ancestors from the root downward.
- A failed action must not leave partial path, status, position, or assignment changes.

## Employee Lifecycle

### Create and Formalize

- Employee number and identity fields are normalized and unique according to the service rules.
- Creation writes the employee and primary assignment atomically.
- Formalization applies only to a probation employee and uses the current employee `version`.

### Transfer and Additional Assignments

- A transfer ends the current primary assignment and creates the new primary assignment in one transaction; there is always exactly one active primary assignment.
- The selected position must belong to the selected enabled organization.
- Secondary and acting assignments are separate historical relationships. End them through the assignment action rather than overwriting or deleting them.
- After a transfer, verify the employee detail, primary organization, position, assignment history, team membership, and account binding.

### Leave

- Record the handover first. Do not process leave while tracked active work remains.
- Leave ends every active assignment and professional-team membership, marks the employee as left, and disables an ordinary bound account atomically.
- The initialized first super-admin is protected and cannot be taken through the ordinary leave path.
- If any part fails, verify that employee status, relationships, and account status all remain unchanged.

## Professional Teams

- Teams may contain employees from different offices and use an open `categoryCode` classification.
- A team has at most one active membership per employee and at most one active `LEAD`.
- Replace a lead through the explicit lead-replacement action. The old lead relationship is ended and retained as history; it is not overwritten.
- End memberships before disabling a team. A team with active members cannot be disabled.
- After membership changes, verify team detail and each affected employee projection.

## Account Binding

- One user can bind to at most one employee, and one employee can bind to at most one user.
- Use the dedicated bind and unbind endpoints; generic user updates cannot change `employeeId`.
- Binding or unbinding increments the employee version and writes a sanitized audit record in the same transaction.
- Never use binding to replace the initialized first-super-admin user, role, or credentials.

## Version Conflicts

Every update, move, enable/disable, lifecycle action, membership action, and binding action that accepts `version` must use the version last read from the server. On `VERSION_CONFLICT`:

1. Do not retry the old request automatically.
2. Reload the latest object and related state.
3. Compare the intervening change with the intended operation.
4. Reapply the change only after the operator confirms it is still valid.

The UI should retain the operator's input where practical, but the server remains the source of truth.

## Post-Change and Recovery Checks

After high-impact maintenance, verify:

- the root remains the only `FIRM` and matches `SystemInitialization.PRIMARY.rootOrganizationId`;
- the initialized first-super-admin user and `SYSTEM_SUPER_ADMIN` role remain enabled and linked to the trust root;
- every organization path and level matches its parent relationship;
- every active assignment references an enabled employee, organization, and matching position;
- every active employee has exactly one primary assignment;
- every professional team has no duplicate active member and at most one active lead;
- audit entries contain stable IDs, codes, states, versions, and timestamps only;
- no partial write remains after a rejected or failed operation.

On inconsistent state, stop writes, preserve sanitized evidence, take a forensic backup, and prepare a reviewed repair plan. Do not use Prisma reset, manual row deletion, trust-root recreation, or direct path/version edits as recovery shortcuts.
