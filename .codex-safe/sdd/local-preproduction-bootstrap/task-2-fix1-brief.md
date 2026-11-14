# Task 2 fix round 1/5 brief

Authority: `.codex-safe/sdd/local-preproduction-bootstrap/task-2-review.md` in full. Address both HIGH and all three MEDIUM findings without expanding beyond Task 2.

Use strict TDD grouped by finding. Add child-process runtime tests and capture meaningful RED before production edits. Use systematic debugging for unexpected failures. Do not manufacture RED for behavior already correct; classify added characterization coverage explicitly.

## Required groups

1. Toolchain provenance: exact two-field scalar resolver schema; canonical rooted paths; reported leaf must be the expected Node command; directly probe the reported Node file and selected npm file for exact versions before any mutation; reject invalid/multiline resolver output, relative/quoted entries, missing files, unrelated leaves, multiple ambient npx entries, cross-directory command shadowing, and name-resolution divergence. Prove post-prepend command resolution canonically equals the two directly probed files. No ambient fallback.
2. Transactional environment: snapshot PATH and all 16 Process values before any mutation; stage toolchain, bundle unprotect, environment validation, and safe records before commit; centralize commit/rollback through narrow injectable operations; rollback must attempt every variable and PATH independently without short-circuiting, verify the full snapshot, and return a stable safe record on any internal failure. No success record may be constructed after a partially committed state.
3. All-stream envelope: child tests capture every PowerShell stream privately, require exactly one safe loader record and zero additional stream records, explicitly require no uncaught invocation failure for every case, and scan captured content without printing it.
4. Failure matrix: inject validation exceptions, each assignment position, rollback failures, PATH restoration failure, safe-record failure, and both module failures. Require all 16 values and PATH restored or a stable rollback-failed classification when persistence is injected. Regenerate report claims from exercised evidence only.
5. Worker force: make deletion of the explicit final force operation observable at runtime through a controlled operation/validation boundary; assert final Process value false, not merely the valid bundle's existing value.

Use `apply_patch`; no Git/GitHub, network, Docker, database, project npm, real loader, or real fixed bundle. Preserve the operator entry behavior with no required parameters; any test injection surface must default to real safe operations, remain local-only, and not expose a remote toggle/path/value output.

Write `.codex-safe/sdd/local-preproduction-bootstrap/task-2-fix1-report.md` with RED/GREEN counts, per-finding closure, AST/forbidden scans, UTC/elapsed, residual risks, and zero prohibited-operation counts. If a root category reaches three failed fixes, stop for architecture review.
