# ADR 0011: Preserve Original OpenCode Fusion Semantics

## Status

Accepted

## Context

The portable Fusion spec should be at least as expressive as the original
OpenCode subagent-based Fusion skill. Most original semantics are already
covered by workers, blindness, synthesis, tool policy, provenance, compliance,
and harness selection.

Three operational semantics need explicit representation:

- The original flow distinguishes synthesis from the final user-facing answer.
- Workers must not recursively spawn panels, councils, or subtasks.
- Important synthesis points should be attributable to worker outputs.

## Decision

The portable contract includes an optional `finalAnswer` separate from
`synthesis`.

Worker policy includes recursive delegation control, defaulting to disabled for
Fusion workers.

The synthesis contract can require attribution from synthesis claims back to
worker outputs.

## Consequences

The portable spec can represent the original OpenCode Fusion behavior without
making OpenCode agent frontmatter normative.

Adapters may still store harness-specific fields such as `hidden`, `mode`,
`temperature`, `top_p`, or `steps` as private adapter metadata.
