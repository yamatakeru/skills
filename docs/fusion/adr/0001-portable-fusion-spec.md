# ADR 0001: Define Fusion As A Portable Protocol

## Status

Accepted

## Context

The repository contains a `fusion` skill inspired by OpenRouter Fusion. The
current skill is optimized for OpenCode and can use hidden subagents such as
`fusion-panelist-gpt`, `fusion-panelist-deepseek`, and
`fusion-panelist-composer`.

The goal is broader than OpenCode-specific subagent usage. Fusion should be a
portable protocol that can be implemented by multiple agent harnesses.

## Decision

Fusion is defined as a portable blind-panel protocol.

Full compliance requires true independent worker invocations. Each worker must
receive the same task prompt and shared context, must not see peer worker
outputs before synthesis, and must run in a separate or otherwise proven
isolated context.

Same-agent internal multiple passes are not full Fusion compliance. They may be
used only as a degraded local simulation and must be disclosed as such.

The OpenCode `agents/fusion-panelist*.md` files are reference examples for an
OpenCode implementation. They are not normative parts of the portable Fusion
protocol.

## Consequences

Fusion documentation must separate protocol requirements from harness-specific
adapter examples.

Portable implementations need a harness-neutral worker contract, including
identity, isolation, blindness, session, model, tool, output, provenance, and
compliance metadata.

Harness-specific implementations such as OpenCode, pi, Claude Code, or direct
API calls may differ operationally, but they must report whether they satisfied
the portable compliance requirements.

## Open Questions

- What exact fields belong in `WorkerRequest` and `WorkerResult`?
- What session reuse modes are allowed without breaking blindness?
- What is the minimum headless harness contract?
- How should harness capabilities be discovered and reported?
