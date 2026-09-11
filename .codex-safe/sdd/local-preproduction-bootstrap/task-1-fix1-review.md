# Task 1 Fix Round 1 Independent Review

## Verdicts

- `SPEC_COMPLIANCE`: `PASS`
- `TASK_QUALITY`: `PASS`

## Safe verification evidence

- Fresh Task 1 tests: total 40, passed 40, failed 0, skipped 0.
- Original findings reviewed: total 7, closed 7, open 0.
- Docker operations: 0.
- Database operations: 0.
- Project command operations: 0.
- Git operations: 0.
- GitHub operations: 0.
- Real fixed bundle creations: 0.

## Severity counts

- Critical: 0.
- Important: 0.
- Minor: 0.

## Finding closure

1. Important physical storage boundary: closed. `.codex-safe/LocalPreproduction.Core.psm1:125` enforces absolute drive-rooted filesystem targets, exact approved-parent containment, and rejection of reparse points in every existing component. The checks repeat immediately before ACL application and immediately before atomic create-new. `.codex-safe/New-ChengyeOALocalPreproductionBundle.ps1:43` pins the wrapper to its approved fixed root and maps rejection to a safe alert.

2. Important protection and credential evidence: closed. `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:202` independently verifies the required protection scope and fixed entropy, rejects alternate entropy, distinguishes the alternate scope with a runtime control, and verifies credential encoding recovery without outputting the value.

3. Important ACL semantics: closed. `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:409` verifies the exact authorized rule count, allow-only full rights, inheritance and propagation flags, inheritance protection, and effective inherited file rules.

4. Important atomic non-overwrite and redirected targets: closed. `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:131` exercises relative, provider-qualified, alternate-root, target-reparse, and ancestor-reparse rejection. `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:287` synchronizes two writers, requires exactly one successful create, and verifies preservation of the winning bytes.

5. Minor exact-key matrix: closed. `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:451` verifies the exact sixteen-key set, every omission, every casing substitution, and an extra key. `.codex-safe/LocalPreproduction.Core.psm1:332` performs case-sensitive key-presence checks.

6. Minor protected malformed-content matrix: closed. `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:357` covers malformed encoding, invalid protected bytes, protected malformed JSON, a protected non-object value, a protected empty object, and non-canonical encoded text, all through the stable safe failure code.

7. Minor safe schemas and dependency failures: closed. `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:611` verifies exact comparison schemas and the eight-field bounded count. `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:712` verifies both dependency-failure branches return the exact safe blocked schema without unsafe detail.

## Findings

- Critical: none.
- Important: none.
- Minor: none.

## Review conclusion

Fix round 1 closes all four Important and all three Minor findings. The implementation is fail-closed at the reviewed storage, protection, validation, parsing, comparison, and dependency boundaries, and the revised tests assert those properties through runtime behavior.
