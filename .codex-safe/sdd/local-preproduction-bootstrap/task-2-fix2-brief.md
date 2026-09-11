# Task 2 fix round 2/5 brief

Authority: `.codex-safe/sdd/local-preproduction-bootstrap/task-2-fix1-review.md` in full.

Address exactly two open findings:

1. After committing the prospective PATH and all 16 Process values, resolve `node.exe` and `npm.cmd` through the actual committed process command search, require their canonical files to equal the pre-probed pinned files, execute both again, and require exact outputs. Any resolution divergence, replacement, launch error, or mismatch must enter the existing transaction failure path and restore the full snapshot before emitting the single safe record. Pre-commit direct probes remain required.
2. Extend the injected commit-failure matrix to the PATH first write and the explicit second Worker-force write. Prove non-short-circuit full rollback, snapshot verification, exact single-record/all-stream behavior, and no residual committed state.

Strict TDD: use a controlled hook to replace or mutate a pinned command after pre-probe but before/during committed recheck; capture meaningful RED before production edits. Add the two missing commit-position RED cases. Then make the smallest production fix and run focused plus combined suites. Use systematic debugging for every unexpected failure.

Do not change the accepted transaction/TestOperations architecture beyond what is required. Use `apply_patch`; no Git/GitHub, network, Docker, database, project npm, real loader, or real fixed bundle. Write `task-2-fix2-report.md` with safe RED/GREEN evidence, UTC/elapsed, operation counts, and finding closure.
