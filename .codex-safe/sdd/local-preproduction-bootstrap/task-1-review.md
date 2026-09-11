# Task 1 Independent Review

## Verdicts

- `SPEC_COMPLIANCE`: `REJECT`
- `TASK_QUALITY`: `REJECT`

## Safe verification evidence

- Fresh Task 1 tests: total 24, passed 24, failed 0, skipped 0.
- Independent credential-encoding round trips: total 200, passed 200, failed 0.
- Docker operations: 0.
- Database operations: 0.
- Project command operations: 0.
- Git operations: 0.
- GitHub operations: 0.
- Real fixed bundle creations: 0.

## Severity counts

- Critical: 0.
- Important: 4.
- Minor: 3.

## Critical findings

None.

## Important findings

1. `.codex-safe/New-ChengyeOALocalPreproductionBundle.ps1:43` and `.codex-safe/LocalPreproduction.Core.psm1:145` — The creation path is joined lexically and the existing parent is accepted without rejecting reparse traversal or verifying the physical target. An occupied reparse ancestor can redirect the ciphertext write and ACL mutation outside the approved storage root. This violates the fixed-target and fail-closed storage boundary. Bounded fix: require an absolute filesystem path, reject provider-qualified and relative targets, reject reparse points in every existing ancestor and at the target, verify the resolved parent remains the approved root immediately before ACL application and atomic creation, and map every rejection to one safe alert code.

2. `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:60` and `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:92` — The runtime tests do not independently detect a change in protection scope or fixed entropy, and they do not assert credential encoding round trips. The current same-context bundle round trip can remain green after a protection-scope mutation. Bounded fix: add runtime tests that independently decrypt with the required scope and entropy, reject alternate scope or entropy, and parse then decode the generated credential component for equality without emitting it.

3. `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:143` — The ACL test checks the authorized principal set and inheritance protection, but not allow-only rules, full rights, inheritance flags, propagation flags, or the created file's effective inherited rules. Bounded fix: assert every directory rule and the resulting file rules at runtime, including rule type, rights, inheritance, and propagation, while reporting only counts.

4. `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:112` and `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:340` — Non-overwrite coverage tests only a target occupied before the call. It does not exercise a competing creation or any unexpected/reparse filesystem target, so mutations that remove atomic create-new behavior or follow redirected storage can pass. Bounded fix: add a synchronized two-writer runtime test that proves exactly one creation and byte preservation, plus isolated rejection tests for relative, provider-qualified, alternate-root, and reparse targets.

## Minor findings

1. `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:169` — Exact-key coverage removes only one required key and adds only one extra key. It does not parameterize every required key, assert the exact generated key set, or exercise casing variants. Bounded fix: enumerate the documented key set and test each omission, the exact set, casing changes, and extras.

2. `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:125` — Ciphertext parsing tests malformed encoding and non-protected bytes, but not valid protected bytes containing malformed JSON, a non-object value, an empty object, or non-canonical encoded text. Bounded fix: construct these cases in memory with the required protection settings and assert the single safe failure code.

3. `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:289` and `.codex-safe/tests/LocalPreproduction.Core.Tests.ps1:359` — Snapshot and module-failure tests do not assert the exact safe schema for every result, the reported eight-field count, or the missing dependency-module branch. Bounded fix: add exact schema assertions for comparison and both import-failure branches, and assert the bounded comparison count is exactly eight.

## Review conclusion

The implemented cryptographic round trip, validation gates, safe record construction, ciphertext rejection, atomic create-new primitive, and eight-field value comparison passed the inspected and fresh runtime checks. Acceptance remains blocked until the physical-target/reparse boundary is enforced and the named security properties have direct mutation-resistant runtime tests.
