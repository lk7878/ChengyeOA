# ChengyeOA Event Center Production Rollout Handoff

Handoff UTC: `2026-07-25T12:43:19.0422200Z`

## Scope and hard constraints

- Workspace: `D:\2_test\16_ChengyeOA`
- Project: `D:\2_test\16_ChengyeOA\LayerManage\law-firm-system`
- Runbook: `D:\2_test\16_ChengyeOA\docs\superpowers\runbooks\reliable-event-center-outbox.md`
- Production rollout is authorized, but every READY gate remains mandatory.
- Never run Git or GitHub commands.
- Never delete, skip, rewrite, or replay production event history.
- Never add a remote Worker toggle, governance-event CLI, or rollback API.
- Never expose production configuration values, credentials, business-sensitive content, raw database diagnostics, stacks, runtime identity fields, or lock-owner data.
- Persist only safe status, counts, alert codes, UTC, and elapsed seconds.

## Production execution state

- Current Codex execution environment gate: `BLOCKED`.
- Required production configuration presence: `0/6`.
- Production mode exact check: `false`.
- Worker-disabled exact check: `false`.
- Fixed Node.js `22.14.0` and npm `10.9.2`: verified.
- Production connections performed: `0`.
- Production preflight runs: `0`.
- Production drain runs: `0`.
- Production canary runs: `0`.
- Remote mutations: `0`.
- No rollback was required from this Codex attempt because no production action started.

The approved workaround is a foreground runner launched once from a new PowerShell after that shell silently loads the existing production environment. The runner inherits the environment; Codex never extracts another process environment and never persists production values.

## Approved design and plan

- Design: `D:\2_test\16_ChengyeOA\docs\superpowers\specs\2026-07-25-event-center-production-runner-handoff-design.md`
- Implementation plan: `D:\2_test\16_ChengyeOA\docs\superpowers\plans\2026-07-25-event-center-production-runner-handoff.md`
- SDD ledger: `D:\2_test\16_ChengyeOA\.codex-safe\sdd\event-center-production-runner-handoff\progress.md`

External steps remain manual through the existing production control plane:

- backup and isolated restore-point verification;
- all-instance Worker disable confirmation;
- matching Server/Web release confirmation;
- controlled governance review operations;
- single-instance Worker enable and rolling restart;
- application rollback and Worker disable after a rollback request.

The runner coordinates and verifies checkpoints but must not implement those remote operations.

## Implementation status

### Task 1 — complete

Pure environment/evidence gates and safe status writer are implemented and independently reviewed.

- Final fresh tests at task completion: `42/42`.
- All Critical/Important findings closed after four fix rounds.
- One deferred Minor: the original pre-implementation RED output survives only as sanitized counts, not as a raw historical artifact.

### Task 2 — complete

Strict Event Center summary parsers, pinned toolchain gate, and fixed command adapter are implemented and independently reviewed.

- Final fresh tests at task completion: `130/130`.
- All review findings closed in fix round 1.
- Source commands suppress the npm envelope.
- Parsers accept exactly one logical formatter record with at most one terminal line ending.
- Non-success exits map before formatter parsing and never propagate raw child output.

### Task 3 — incomplete; review rejected

The initial foreground state machine and helper scripts were implemented. Before review, controller verification reported:

- full tests: `151/151`;
- AST errors: `0`;
- Core public exports: `9`.

Independent Task 3 review rejected the implementation with `2 Critical`, `5 Important`, and `2 Minor` findings. No reviewed fix has been applied.

Open findings:

- `C1`: rollback confirmation is not bound to the UTC of the rollback request.
- `C2`: BLOCKED canary waits for governance completion before requesting rollback.
- `I1`: production-like safe adapter exit classifications `2/5/70` collapse into rollback exit `4`.
- `I2`: a non-ready post-rollback preflight can still produce a terminal READY record.
- `I3`: the production wrapper lacks a sanitized top-level bootstrap failure boundary.
- `I4`: helper target checks are lexical and do not enforce the exact physical safe directory or reparse-point rejection.
- `I5`: existing fixtures conceal the protocol defects above.
- `M1`: wrapper binding and console/status equivalence lack behavior coverage.
- `M2`: helper partial-write, first-move, replacement-failure, preservation, cleanup, and reparse behavior lack coverage.

Authoritative review: `D:\2_test\16_ChengyeOA\.codex-safe\sdd\event-center-production-runner-handoff\task-3-review.md`

## Current filesystem state at pause

The four production runner files still match the snapshots that received the rejected Task 3 review. Interrupted fix agents did not change them.

- `ProductionRolloutRunner.Core.psm1`: `66FEA2673701AEBC995B27E97BA06551AAB0591AF5F5A5FA7184BDE6EF432AE7`
- `Invoke-EventCenterProductionRollout.ps1`: `F6D8A4095593D58A1EC14C7AC713F47F372559FC587E7E988F96986FDAE35941`
- `Set-ProductionRunnerCheckpoint.ps1`: `B97ECBE27E77B63D8807C6A4F2A11DE23456090C1CD6F220FB35DB258A807275`
- `Set-ProductionRolloutEvidence.ps1`: `50BF09AB0706F247CE08525E084AE9193D183A45215B0E21E253CCAC34C03389`
- baseline state-machine tests: `C60F1B025526C729A9E91A1EAA4CF710581D596121FC6AA8198891310FE7AECF`

A partial file exists at:

`D:\2_test\16_ChengyeOA\.codex-safe\tests\ProductionRolloutRunner.StateMachine.FixRound1.Tests.ps1`

It contains three unconditional failing scaffolds only. It is not valid behavioral RED evidence and must be replaced with concrete regression tests before any Task 3 production-file change. Its current hash is `28C0BE6D8C99AAB4FE5B2EC23FE25BB9661B524C3784B4D11029C0F1B2EDF554`.

## Exact resume point

Resume `Task 3 fix round 1/5` with one fresh implementer. Do not dispatch multiple implementers in parallel.

1. Read the Task 3 brief and rejected review.
2. Replace the three unconditional scaffolds with real focused behavior tests for `C1`, `C2`, `I1`–`I5`, `M1`, and `M2`.
3. Run the focused suite and record a meaningful RED caused by the open defects.
4. Apply only the minimal fixes required by those findings.
5. Obtain focused GREEN and full Task 1–3 GREEN.
6. Run fresh controller verification for test totals, AST errors, export count, forbidden-output findings, production connections, and remote mutations.
7. Create a no-Git full-file snapshot review package and dispatch a scoped independent reviewer.
8. Do not mark Task 3 complete until all Critical/Important findings are addressed.
9. Complete Task 4 zero-environment dry-run and broad final review.
10. Only after the runner has a clean final review may the operator launch it from a newly loaded PowerShell.

## Expected operator launch after implementation is clean

From `D:\2_test\16_ChengyeOA`, after silently loading the production environment in that same PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\.codex-safe\Invoke-EventCenterProductionRollout.ps1
```

The process must remain in the foreground. Codex then watches only the safe status file and coordinates manual checkpoints. It must not proceed past missing evidence, DEGRADED, or BLOCKED.

## Pause status

- All subagents are interrupted or completed; none remain active.
- No implementation or verification command is running.
- Production remains untouched.

---

## Authoritative update — 2026-07-26

This section supersedes the earlier Task 3, resume-point, launch, and pause sections above.

### Implementation and review status

- Task 3 is complete after five bounded RED/GREEN/re-review rounds.
- Root fresh verification: `245/245` tests across `16` test files; failures `0`.
- PowerShell AST errors: `0` across `20` implementation/test files.
- Core public exports: `9`.
- Final Task 3 independent review: `SPEC_COMPLIANCE PASS_WITH_MINOR`, `TASK_QUALITY PASS_WITH_MINOR`, Critical `0`, Important `0`, Minor `1`.
- Task 4 zero-environment gate reached `ENV_GATE/BLOCKED` with exit `2`, seven safe fields, zero production connections, zero project commands, and zero remote mutations.
- Runtime output scan: status records `3`, invalid records `0`, forbidden findings `0`. These append-only dry-run records must be retained.
- Task 4 final review: implementation `PASS_WITH_MINOR`; `LAUNCH_READINESS LAUNCH_BLOCKED`.

### Current blocker

`TOOLCHAIN_VERSION_MISMATCH`

The current direct `node.exe` and `npm.cmd` PATH did not pass the pinned-version boolean gate. The attempted npx-to-PowerShell envelope also did not produce a verified pinned direct PATH in the current constrained process. The production runner has therefore not been launched.

### Exact resume point

1. Open or reuse the operator PowerShell that silently loads the authorized production environment.
2. In that same shell, establish a direct PATH where `node.exe` is exactly `22.14.0` and `npm.cmd` is exactly `10.9.2`.
3. Run a zero-value boolean version check that emits only status/counts. Do not print PATH, versions, environment values, or diagnostics.
4. Only after that check is `READY`, start the runner in the same foreground shell with the existing fixed command.
5. The runner must pass its own `ENV_GATE`, `TOOLCHAIN_GATE`, and external evidence gate before any source/portable command can run.
6. Do not create production evidence or checkpoints until their external conclusions/actions have actually been verified.

### Production counters at this handoff

- production connections: `0`
- production preflights: `0`
- production drains: `0`
- production canaries: `0`
- remote mutations: `0`
