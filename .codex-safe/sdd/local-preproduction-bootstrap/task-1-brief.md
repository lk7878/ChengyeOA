# Task 1 brief — DPAPI Secret and Validation Core

Plan authority: `D:\2_test\16_ChengyeOA\docs\superpowers\plans\2026-07-26-local-preproduction-bootstrap.md`, Task 1 only.

## Scope

- Create `.codex-safe/LocalPreproduction.Core.psm1`.
- Create `.codex-safe/New-ChengyeOALocalPreproductionBundle.ps1`.
- Create `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1`.
- Reuse `New-SafeStatusRecord` from `.codex-safe/ProductionRolloutRunner.Core.psm1`.
- Do not create the real fixed DPAPI bundle in this task; tests use `$TestDrive`.
- Do not call Docker, a database, project npm commands, Git, or GitHub.

## Required behavior

Implement all Task 1 interfaces and exact rules from the plan: cryptographically random material; fixed local-preproduction values and ports; DPAPI `CurrentUser` with fixed entropy label; UTF-8 JSON protected before disk; ciphertext-only non-overwriting storage; ACL restricted to current Windows user and SYSTEM; fail-closed environment validation without rejected-value leakage; one-time creation wrapper; and source/portable snapshot comparison over only the eight documented durable fields.

The real creation wrapper must resolve only the fixed `%LOCALAPPDATA%\ChengyeOA\local-preproduction\environment.dpapi` target, must never overwrite, and must return a safe `BLOCKED` record with `SECRET_BUNDLE_ALREADY_EXISTS` when occupied. Module import failure is `BLOCKED`. No secret, URL, filesystem secret path, raw error, stack, host, process/container identifier, worker identifier, or lock owner may be printed or persisted in test/report output.

## TDD protocol

1. Before each test body, name the production mutation/bug it catches.
2. Write behavior tests first and run them against the missing behavior.
3. Record only sanitized RED counts and the expected missing-behavior category; do not persist raw output.
4. Implement the minimum behavior required.
5. Run focused GREEN and then the whole Task 1 test file.
6. Add boundary tests for invalid ports, malformed/invalid DPAPI ciphertext, missing/extraneous keys as appropriate, APP key and MFA validation, non-loopback/sample inputs, non-overwrite behavior, exact snapshot equality/mismatch, and output leakage.
7. Tests must exercise runtime behavior, not grep source text. Mocks are allowed only at external boundaries and assertions must be on real outcomes.

## Report

Write `.codex-safe/sdd/local-preproduction-bootstrap/task-1-report.md` with: files changed, sanitized RED/GREEN counts, test commands, UTC start/end, elapsed seconds, alert codes, residual risks, and explicit counts of Docker/database/project/Git operations (all must be zero). Do not include generated values, paths to secret storage, raw failures, stacks, or forbidden identifiers.

Do not mark later tasks complete and do not modify the plan document.
