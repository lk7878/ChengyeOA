# Task 3 fix round 3/5 brief

Authority: `task-3-fix2-review.md`.

1. Eliminate the process-start-before-job-assignment race. The native child must be created suspended (or through an equivalently race-free containment handshake), assigned to the kill-on-close Job Object, and only then allowed to execute. If creation/assignment/resume fails, terminate the created direct process, confirm exit with a bounded wait, close all handles, and return an unconfirmed-termination failure when exit cannot be proven. Add an immediate-descendant fixture with no artificial delay and an assignment-failure fixture proving the direct child is dead/unlocked.
2. Reserve real monotonic overhead before every sleep and next-loop action. Sleep must be strictly less than the Stopwatch remainder by a documented bounded reserve; do not call sleep when the remainder is at/below reserve. Tighten the scaled test so measured health elapsed is at or below the configured test budget plus only a very small measurement tolerance, not 400ms for 250ms.

Strict TDD and systematic debugging. Minimal production changes, full cleanup/error-stream safety. No real initializer/Docker/Compose/database/network/npm/fixed bundle/Git/GitHub. Focused/full/AST/all-stream and task-3-fix3-report.md with LIVE_RESET_EXECUTED=0.
