# Task 3 fix round 1/5 brief

Authority: `task-3-review.md` in full. Address C1, C2, I1, I2, I3, and M1.

Strict TDD grouped work:

1. Native real-time bound: concurrent async stdout/stderr draining; bounded monotonic wait; safe termination on timeout; sanitized timeout result; health receives remaining budget. Add harmless local hanging and pipe-fill fixtures with short bounds. No external tools.
2. Physical target: inspect every existing path component from filesystem root through repository root and leaf, including repository root and ancestors. Add root and ancestor reparse fixtures with metadata calls 0.
3. Health termination: nonreplaceable Stopwatch guard plus finite attempt cap. Constant/regressing injected clock and no-op sleep must return timeout within a short real bound.
4. Injected streams: suppress warning/error/verbose/debug/information, require exactly one exact-schema result, noisy/malformed injection becomes failure, and initializer emits one safe record.
5. Destructive contract: exact immutable count-call token array and exact fixed SQL; mutation cases for reorder/add/remove/substitute. Runtime-test Windows quoting for empty/spaced/quoted/trailing-backslash operands and a harmless local argument echo.
6. Environment equality: independently mutate all 16 names; every case blocks before metadata/destructive calls.

Use systematic debugging, small RED groups, minimal fixes, focused/full tests, AST/all-stream scan. Do not execute real initializer/Docker/Compose/database/network/npm/fixed bundle/Git/GitHub. Keep `LIVE_RESET_EXECUTED=0`, `RESET_READY_ONLY=1`. Write task-3-fix1-report.md.
