# Task 3 fix round 2/5 brief

Authority: `task-3-fix1-review.md`.

Address two open findings only:

1. A timed-out native process must not be treated as safely timed out until termination is confirmed. Capture meaningful RED for kill failure and ignored post-kill wait. Implement bounded termination with tree-aware fallback where available, verify exit, expose only sanitized internal termination status, and ensure initializer never proceeds/returns READY when termination is unconfirmed. Tests must verify the child is no longer alive and include kill-failure plus descendant coverage without outputting identifiers.
2. Health sleep must be capped by the nonreplaceable Stopwatch real remaining budget as well as logical remaining. A slow failed health call near deadline must not be followed by a sleep that takes total real elapsed beyond 120 seconds. Add a short scaled deterministic fixture proving the cap and retain constant/regressing/no-op cases.

Strict TDD, systematic debugging, minimal fixes, focused/full/AST/all-stream verification. No real initializer/Docker/Compose/database/network/npm/fixed bundle/Git/GitHub. Keep LIVE_RESET_EXECUTED=0 and write task-3-fix2-report.md.
