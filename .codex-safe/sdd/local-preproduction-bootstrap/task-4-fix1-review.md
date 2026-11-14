# Task 4 Fix Round 1 Independent Review

## Verdict

- SPEC_COMPLIANCE: PASS
- TASK_QUALITY: PASS
- Fix disposition: PASS_WITH_TOOLCHAIN_VERIFICATION_BLOCKED
- Critical: 0
- Important: 0
- Minor: 0
- C1: CLOSED
- I1: CLOSED
- TOOLCHAIN_VERIFICATION_BLOCKED: TOOLCHAIN_VERSION_MISMATCH
- LIVE_INITIALIZATION_EXECUTED=0
- OPERATOR_SECRET_INPUT_REQUESTED=0

## C1 closure

The revised authority is explicit at `docs/superpowers/plans/2026-07-26-local-preproduction-bootstrap.md:371`: local preproduction must use a silent package-manager call, the dedicated safe-interactive mode, fixed safe labels, hidden input for every operator value, and no ordinary command output.

The wrapper uses the exact safe argument vector in both injected and production paths at `.codex-safe/Initialize-ChengyeOALocalPreproduction.ps1:332` and line 350. It retains inherited stdin/stdout/stderr at lines 334–336 and uses the same console without standard-stream redirection at lines 348–355. Static counts: exact argument vectors 2, inherited flags 3, redirection parameters 0.

The authoritative CLI defines five fixed non-interpolated labels at `LayerManage/law-firm-system/apps/server/scripts/system/system-cli.ts:68`, accepts only the dedicated mode at line 93 and lines 136–145, and requests all five operator values through the hidden-input method at lines 106–111. Safe mode suppresses location and completion writes at lines 97 and 127, and passes the mode into error reporting at line 130. Every ordinary error write is guarded by the silent flag at lines 341–367. The default mode remains on the prior interaction branch at lines 112–127.

The real prompt adapter routes the hidden-input method through its muted branch at `LayerManage/law-firm-system/apps/server/scripts/system/terminal-prompts.ts:47` and lines 55–67. The focused CLI tests cover the generic muted prompt contract at `LayerManage/law-firm-system/apps/server/test/system/system-cli.test.ts:185`, the successful five-input safe transcript at line 265, and the silent error transcript at line 303. The repository bootstrap security contract remains represented by the repository-source acceptance test at `LayerManage/law-firm-system/apps/server/test/ci/bootstrap-contract.test.ts:79` and the credential-channel mutation matrix beginning at line 373. The PowerShell wrapper contract verifies the exact quiet safe-mode arguments and inherited console flags at `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:1702`.

Conclusion: C1 is closed by implementation and static contract coverage. No operator value is placed in an argument or echoing input path; safe mode emits only fixed prompt labels while the wrapper owns waiting, success, and failure records.

## I1 closure

The slow health fixture now begins operation-owned timing at the first health call and caps every simulated call duration by that call's supplied remaining timeout at `.codex-safe/tests/LocalPreproduction.Workflow.Tests.ps1:714`. The timer is stopped immediately after the initializer returns at lines 829–832, before the explicit caller-only delay at lines 841–843.

The regression at lines 2260–2282 separately asserts the bounded logical sleep request, one-to-one timeout compliance for every simulated health call, a 750 ms operation-owned watchdog, and a deliberately loose 2000 ms outer watchdog that includes 600 ms of caller-only delay. Three fresh directed runs passed 3/3. This measures the behavior boundary without making unrelated caller scheduling the correctness threshold.

Conclusion: I1 is closed. The production health budget and fail-closed behavior were not changed.

## Safe verification evidence

- Fresh Task 1–4 Pester: total 94, passed 94, failed 0, skipped 0.
- Fresh focused Task 4 Pester: total 2, passed 2, failed 0, skipped 0.
- Fresh directed I1 repetitions: runs 3, passed 3, failed 0.
- C1 static contract: exact safe argument vectors 2; inherited stream flags 3; redirection parameters 0; hidden input calls 5; echoing input calls 0; fixed labels 5; label interpolations 0; guarded bootstrap writes 2; guarded error writes 7.
- Fixed Node version match: 0.
- Fixed npm version match: 0.
- Independent authoritative TypeScript test executions: 0.
- Non-authoritative TypeScript harness test executions: 0; harness did not enter the test body.
- Real initializer invocations: 0.
- Live initialization executions: 0.
- Live reset executions: 0.
- Docker operations: 0.
- Database operations: 0.
- Project package-manager operations: 0.
- Interactive bootstrap operations: 0.
- Network operations: 0.
- Operator secret-input requests: 0.
- Later-task operations: 0.

## Toolchain limitation

The current review process does not resolve the required fixed Node and npm versions. Both observed command resolutions mismatch the pinned versions. Therefore the implementer's TypeScript and 140-test evidence is not restated as fresh independent fixed-toolchain verification. Before live initialization, rerun the focused CLI and bootstrap security-contract suites under the already approved pinned toolchain. This limitation does not reopen C1's code finding, but it remains an explicit execution gate.
