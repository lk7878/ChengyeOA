# ADR 0001: Project Repository Boundary

## Status

Accepted on 2026-07-14.

## Context

The workspace contains the Chengye OA product, documentation, and reference repositories. A single reviewable change set needs to include the product and its engineering records without absorbing unrelated codebases.

## Decision

`D:\2_test\16_ChengyeOA` is the repository root. `LayerManage/law-firm-system` is the tracked product. `LawLink` and `LexNebulis` remain ignored, independent reference repositories.

## Consequences

Specs, plans, ADRs, and runbooks live under `docs/superpowers`. Product code remains under `LayerManage`. Reference repositories are never staged, modified, or treated as runtime dependencies.

## Supersedes

No prior repository-boundary decision.
