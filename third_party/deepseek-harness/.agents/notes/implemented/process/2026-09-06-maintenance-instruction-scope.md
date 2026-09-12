# Agent Note: Maintenance instruction scope and evidence

Status: implemented

English | [中文](2026-09-06-maintenance-instruction-scope.zh.md)

## Problem

Maintenance instructions mixed business requirements with workflow defaults. Requiring a literal scope parameter could stop an otherwise clear editing request. Requiring execution of every documented operation could trigger unauthorized side effects or delete valid requirements on an unsupported host. Repeated full-check lists and README wrappers also increased the cost of small instruction edits.

## Decision

[Root instructions](../../../../AGENTS.md#scope-and-authority) own task scope and authorization. User directions override skill guidelines within system and developer limits. Context supplies routine details; missing authorization blocks only the dependent action. Review, editing, and validation do not independently authorize remote publication or messages.

[The documentation workflow](../../../skills/dsh-doc/SKILL.md) distinguishes source inspection from execution, selects checks by changed content, and loads format references on demand. Instruction files and short references can omit README wrappers. Missing execution evidence is reported precisely without discarding supported security, failure, or compatibility requirements. The bilingual link reference follows the existing pairing rule: missing in-scope translations are errors.

This decision applies the prompting recommendations in the [GPT-6 Astra official guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra), consulted on 2026-09-06, to maintenance workflows. It does not select a runtime model or change product behavior. The [documentation tiers decision](2026-07-04-doc-tiers-and-budgets.md) and [concrete prose decision](2026-08-09-concrete-prose-names-actors-and-recorded-facts.md) remain active owners of placement and factual preservation; neither is fully superseded.

## Alternatives considered

**Copy the full model guide into each skill.** This duplicates guidance and creates more places for authorization and verification rules to diverge.

**Remove operational constraints with procedural detail.** Shorter files would lose protections for durable formats, archived notes, generated outputs, bilingual pairs, credentials, and remote actions. Those requirements remain in their existing owners.

## Consequences

Routine edits can proceed from context while external actions retain explicit authorization. Check results must distinguish passed, unrun, blocked, and pre-existing failures. Static Markdown and skill checks establish structure and links; they do not prove future model behavior. Behavioral review should cover a context-scoped edit, unavailable runtime evidence, a read-only PR review, and an already-authorized publication without performing that publication during an instruction audit.
