# ADR 0006: Use Read-Only Tools By Default

## Status

Accepted

Amended by ADR 0018: the default read-only policy now includes web search and
web fetch where the harness provides them.

## Context

Fusion workers may run through different harnesses and models. If workers in the
same panel receive materially different tool access, the panel may compare tool
capability differences rather than independent model judgment.

At the same time, strict identical tool parity across OpenCode, pi, Claude Code,
and other adapters may be too brittle for a portable protocol.

## Decision

Fusion workers use read-only tools by default.

Within a single panel, workers should receive the same `toolsPolicy` by default.
Differences are allowed only when required by harness constraints or explicit
policy, and those differences must be recorded in provenance and compliance
metadata.

Harness defaults must not silently define worker permissions for portable Fusion
runs. If an adapter cannot enforce the requested tool policy, it must report that
limitation.

## Consequences

Read/search/list operations can be pre-approved for code and repository tasks.

Write, edit, destructive shell commands, and approval-heavy operations should be
denied by default for workers.

Tool differences do not automatically make a run non-compliant, but they reduce
comparability and must be visible to the orchestrator and final synthesis.

## Guidance

- Default `toolsPolicy.mode`: `read-only`.
- Same panel, same `toolsPolicy` by default.
- Tool-policy differences should produce warnings or degraded notes.
- Harness defaults are acceptable only as an explicitly recorded adapter
  limitation or legacy mode.
