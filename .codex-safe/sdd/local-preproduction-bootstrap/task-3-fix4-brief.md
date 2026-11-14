# Task 3 fix round 4/5 brief

Authority: `task-3-fix3-review.md`.

Address one Important finding only. Every failure after successful CreateProcess—including pipe/reader/SuspendedProcess construction failure and a terminating TestAssignmentOperation exception—must invoke direct-child termination, positively confirm bounded exit, close every handle/stream, and propagate `TerminationConfirmed=false` when confirmation fails. No path may fall back to a default true value.

Strict TDD: inject constructor/setup failure after process creation and a terminating assignment-hook exception; prove child death/unlock and safe false classification on forced confirmation failure. Minimal change, preserve suspended assign/resume path. Focused/full/AST/all-stream/report, no real/external operations, LIVE_RESET_EXECUTED=0.
