# Task 2 fix round 3/5 brief

Authority: `.codex-safe/sdd/local-preproduction-bootstrap/task-2-fix2-review.md`.

Address one bounded defect only: when an actual post-commit toolchain recheck fails and snapshot rollback also fails, the single `ENVIRONMENT_ROLLBACK_FAILED` record must report `toolchainReady=0`, not 1. Preserve `toolchainReady=1` for an environment-import-origin rollback failure when the toolchain recheck itself remained valid.

Strict TDD: inject a post-commit tool mismatch together with a persistent rollback failure; capture meaningful RED for the bounded count while preserving one safe record/all-stream constraints. Then implement origin-aware rollback-failure records or equivalent minimal logic. Add/retain an import-origin rollback-failure characterization proving readiness remains 1. Run focused and combined suites, AST, all-stream scan, and write `task-2-fix3-report.md`.

Use `apply_patch`; no Git/GitHub, network, Docker, database, project npm, real loader, or real fixed bundle.
