# Task 1 Brief: Fixed Isolated Compose Target Contract

## Authority

Implement Task 1 only from `docs/superpowers/plans/2026-07-27-local-preproduction-compose-isolation.md`, based on the approved design in `docs/superpowers/specs/2026-07-27-local-preproduction-compose-isolation-design.md`.

## Required result

- Add the minimal fixed Compose override.
- Make the target resolver validate the fixed base file, fixed override, fixed project, one service, and one logical volume.
- Add `New-LocalPreproductionComposeArguments` and route every initializer Compose call through it.
- Reject tail attempts to inject another project or Compose file option.
- Preserve every Task 1-4 gate already present.

## TDD evidence

- First run meaningful focused RED tests against the current implementation.
- Then implement the minimum change and run focused GREEN.
- Run the complete Core and Workflow suite.
- Run AST and static operational-prefix scans.

## Prohibited operations

- No Git or GitHub commands.
- No Docker command, database connection, initializer, bootstrap, package resolution, network request, or operator-input request.
- Do not modify the existing default volume or any live resource.
- Do not change Task 2 orchestration order yet beyond routing existing calls through the centralized prefix.

## Safe reporting

Report only status, test counts, stable alert codes, UTC, elapsed duration, finding counts, and zero prohibited-operation counts. Never expose URLs, credentials, command payloads, raw errors, stack traces, host data, process identifiers, Worker ownership data, resolved resource names, or executable/secret paths.

## Completion artifact

Write `.codex-safe/sdd/local-preproduction-compose-isolation/task-1-report.md` and finish only when the Task 1 focused tests and full regression pass with zero live operations.
