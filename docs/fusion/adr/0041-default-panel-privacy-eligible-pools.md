# ADR 0041: Default Panel Privacy-Eligible Pools

## Status

Accepted

## Context

The former parent / OpenAI-tier / low-cost default encoded price and provider
positioning more strongly than the perspectives Fusion needs. It also drew
automatic candidates from free OpenCode Zen models. During their free period,
OpenCode Zen states that collected data may be used to improve the model,
whereas OpenCode Go has a zero-retention policy. Automatic selection should not
silently choose the former data posture.

The default resolver deduplicates exact resolved model IDs. Availability can
still exhaust every distinct candidate, especially in partial catalogs, and a
three-seat deliberation benefits from a disclosed degraded result instead of an
avoidable hard failure when the parent model did resolve.

## Decision

The default composition is parent / strong / efficient. The `strong` slot
resolves `strong-generalist`; the `efficient` slot resolves
`efficient-generalist`. Perspective diversity is a soft objective only: there
is no family-aware scoring or suffix normalization. Refill considers the
strong candidates followed by the efficient candidates, deduplicated in that
order.

All automatically selectable candidates are privacy-eligible. Free models are
excluded from both default pools and remain available only through explicit
`--models` entries. `openai-flagship` and `budget-smart` remain compatibility
aliases but are not defaults. `budget-smart` is redefined to the exact
`efficient-generalist` candidate pool from one shared runtime constant.

When the effective panel size is three or fewer and distinct candidates are
exhausted, remaining seats may duplicate only the successfully resolved parent
seat. Each duplicate has slot `parent-repeat` and emits a degraded warning.
This is keyed to effective size, so explicit `--panelists 3` and the bare
default behave identically. If `--parent-model` is omitted or its entry fails
availability, insufficiency remains an error and recommends passing
`--parent-model`; sizes of four or more never repeat the parent. Explicit
`--models` duplicate semantics are unchanged.

Resolved slot names are now `parent`, `strong`, `efficient`, `refill`,
`parent-repeat`, and `explicit`. This intentionally breaks the
`DryRunReport` JSON schema enum with no compatibility shim, following ADR
0031's precedent for an internal draft contract.

Concrete candidate chains are disclosed only by `--help` and `--dry-run`; the
runtime alias table is the source of truth. The judge continues to default to
the parent model.

This ADR supersedes ADR 0015's default composition and duplicate rule. It also
partially supersedes ADR 0036's decision to list concrete alias chains in
`SKILL.md`.

## Consequences

- Default panels favor strong and efficient generalists without claiming that
  every result is from a different model family.
- Automatic resolution cannot select a free model with the less restrictive
  free-period data policy.
- Small panels can complete in a visibly degraded mode when only the parent is
  available; absent-parent and larger-panel failures stay explicit.
- Dry-run consumers must adopt the new slot enum.
- Exact-ID deduplication retains a known limitation: a parent such as
  `openai/gpt-5.6-sol-fast` can yield two same-base seats. This is accepted;
  family normalization is out of scope.
- Alias-chain documentation cannot drift from runtime because `--help` renders
  the table dynamically and `--dry-run` reports actual resolution.
