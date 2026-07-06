# ADR 0017: Retire Legacy Execution Tiers

## Status

Accepted

## Context

The pre-runtime `SKILL.md` offered tiered execution: direct answers, an
internal blind panel (multiple same-agent passes), and OpenCode hidden
subagents (`fusion-panelist-*`). ADR 0014 makes the bundled CLI the canonical
execution path, and the spec has always classified same-agent internal passes
as degraded simulation, not full compliance.

## Decision

The hidden-subagent tier is removed from the skill. The `fusion-panelist-*`
agents remain reference examples only, as ADR 0011 already established.

The internal-pass simulation survives only as an emergency fallback for
environments where the CLI cannot run (for example, missing Bun or no usable
harness). When used, it must announce itself as a degraded simulation before
producing results; silent fallback is prohibited.

Direct answers for trivial or narrow tasks remain outside panel execution.

Once the skill and runtime are mature, removing the emergency internal
fallback entirely will be evaluated, leaving explicit failure as the only
behavior when the CLI is unavailable.

## Consequences

The skill has one panel execution story to document, test, and audit. Users in
environments without Bun temporarily keep a clearly-labeled degraded option
instead of a hard failure, but that grace path is explicitly scheduled for
reconsideration rather than being a permanent contract.
