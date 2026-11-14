# Task 1 independent review brief

Authority: Task 1 and Global Constraints in `D:\2_test\16_ChengyeOA\docs\superpowers\plans\2026-07-26-local-preproduction-bootstrap.md`.

Review all files in full:

- `.codex-safe/LocalPreproduction.Core.psm1`
- `.codex-safe/New-ChengyeOALocalPreproductionBundle.ps1`
- `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1`
- `.codex-safe/sdd/local-preproduction-bootstrap/task-1-brief.md`
- `.codex-safe/sdd/local-preproduction-bootstrap/task-1-report.md`

No Git diff is available or permitted. Review the complete files against the plan, not only the report. Do not edit any implementation file and do not create the real fixed bundle. Do not call Docker, database, project npm, Git, or GitHub.

Independently run the Task 1 tests with all streams captured and report only sanitized totals. Inspect for correctness, security, fail-closed behavior, and test quality. In particular pressure-test: exact key rules; URI credential encoding round trip; DPAPI CurrentUser and entropy; non-overwrite race behavior; ACL identities/inheritance; unexpected filesystem targets or reparse traversal; module import failures; ciphertext parsing; rejected-value leakage; safe record schema; and exact eight-field snapshot comparison. Tests must assert runtime behavior and not merely source text.

Write `.codex-safe/sdd/local-preproduction-bootstrap/task-1-review.md` with two verdicts: `SPEC_COMPLIANCE` and `TASK_QUALITY`, each one of PASS, PASS_WITH_MINOR, or REJECT. List findings by Critical/Important/Minor with file and line. Use only safe status/count/alert language; never include generated values, secret paths, URLs, raw errors, stacks, or forbidden identifiers. If rejecting, provide bounded actionable fixes. If no findings, state counts zero.
