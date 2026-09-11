# Task 2 independent review brief

Authority: Global Constraints and Task 2 in `D:\2_test\16_ChengyeOA\docs\superpowers\plans\2026-07-26-local-preproduction-bootstrap.md` plus `.codex-safe/sdd/local-preproduction-bootstrap/task-2-brief.md`.

Read current full files: loader, workflow tests, Task 1 core, runner core toolchain helpers, and Task 2 report. No Git diff is available or permitted.

Review read-only for spec compliance, security, atomic process mutation, and mutation-resistant tests. Independently run Task 2 and combined tests with raw streams suppressed. Adversarially inspect:

- exactly one available `npx.cmd` and no ambient fallback;
- exact package requests, resolver output shape, rooted/existing node executable, child PATH parsing, exactly one matching npm directory, and exact version recheck;
- whether resolved executables/directories can be spoofed or escape the intended npx child context;
- PowerShell 5 argument and output parsing, malformed/multiline resolver data, quoting, and path separators;
- failure rollback of PATH and all 16 allow-listed Process variables, including exceptions during mutation/rollback;
- no User/Machine scope writes, no remote Worker toggle, exact Worker false;
- bundle missing/invalid/validation mapping, module failures, and no partial import;
- exactly one safe status record and no value/path/raw output/stack/identifier leakage;
- tests using real behavior at controlled external boundaries, correct real workspace layout, and no hidden network dependency.

Do not edit implementation/tests, run the real loader, create a fixed bundle, or call network/Docker/database/project npm/Git/GitHub. Write `.codex-safe/sdd/local-preproduction-bootstrap/task-2-review.md` with SPEC_COMPLIANCE and TASK_QUALITY verdicts, severity findings with file/line and bounded fixes, safe test counts, and operation counts.
