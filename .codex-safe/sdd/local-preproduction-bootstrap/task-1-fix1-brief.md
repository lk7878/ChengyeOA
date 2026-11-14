# Task 1 fix round 1/5 brief

Authority: `.codex-safe/sdd/local-preproduction-bootstrap/task-1-review.md` in full. Address all four Important and all three Minor findings without changing Task 1 scope.

Use strict TDD per finding groups. Add meaningful runtime tests first and capture sanitized RED counts before production edits. Then make minimal fixes and run focused GREEN plus the entire Task 1 file. Do not grep source text as a test.

Required groups:

1. Enforce the fixed physical storage boundary: absolute filesystem paths only; reject relative/provider-qualified/alternate-root targets; reject target or any existing ancestor that is a reparse point; verify the physical approved parent immediately before ACL and atomic creation; stable safe failure mapping. Generic test paths must remain safely usable under `$TestDrive`, while the creation wrapper alone pins the approved fixed root.
2. Add independent DPAPI scope/entropy and credential-encoding runtime tests without outputting values.
3. Assert complete directory and resulting file ACL semantics at runtime using counts/booleans only.
4. Add a synchronized two-writer non-overwrite test with exactly one successful create and preserved winning bytes; add the unexpected/reparse target tests.
5. Parameterize the exact 16-key set, every omission, casing variants, and extras.
6. Add protected malformed-JSON/non-object/empty-object/non-canonical ciphertext tests.
7. Assert exact safe schema/eight-field count and both dependency import-failure branches.

Use `apply_patch`; no Git/GitHub, Docker, database, project npm, real fixed bundle, or external connection. Never persist or print generated values, secret paths, URLs, raw errors, stacks, or forbidden identifiers. Update the existing Task 1 report or create `task-1-fix1-report.md` with RED/GREEN counts, per-finding closure, UTC/elapsed, alert codes, and zero operation counts.

If a root-cause category reaches three failed fixes, stop and report `ARCHITECTURE_REVIEW_REQUIRED` instead of stacking another fix.
