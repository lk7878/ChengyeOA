# Task 3 Brief: Full Regression and Launch Readiness

## Authority

Execute Task 3 from the approved isolation design and plan. This task may update documentation and produce safe verification evidence only.

## Required work

- Append a dated addendum to the original local-preproduction bootstrap plan; never rewrite earlier plan history.
- Record only that the default project was discovered nonempty, deletion was blocked, and all subsequent initialization uses the fixed isolated project.
- Run the complete Core and Workflow suite from the 109-test baseline.
- Run AST and static scans for fixed prefixes, base-only calls, destructive patterns, environment persistence, remote Worker toggles, and forbidden output.
- Run the real loader gate with offline package mode forced in the process, proving cached fixed Node/npm, production mode, Worker disabled, required environment presence, one safe record, and zero extra streams.
- Produce `ISOLATED_INITIALIZER_READY` only if every gate passes.

## Prohibited operations

- No Git/GitHub.
- No Docker, database, initializer, bootstrap, operator input, or default-volume access.
- No network access; the loader gate must be offline and fail closed if the pinned cache is unavailable.
- No code or test behavior change. If verification exposes a defect, stop with a stable code and report it instead of fixing within this task.

## Completion artifact

Write `.codex-safe/sdd/local-preproduction-compose-isolation/task-3-report.md` containing safe counts, UTC, elapsed duration, and `LIVE_ISOLATED_RESOURCES_CREATED=0`.
