# ADR 0021: Reasoning Preference Pass-Through

## Status

Accepted

## Context

OpenRouter Fusion forwards a `reasoning` object (optional `effort` and
`max_tokens`) to every panel and judge call, defaulting to provider defaults
with no built-in depth floor. The portable contract had no equivalent field,
so callers could not raise worker reasoning depth at all; neither could the
CLI. The contract's `WorkerBudget` already defines `maxTurns` and
`maxToolCalls`, but no CLI flag wires them.

## Decision

The contract gains a `ReasoningPreference` value object with optional
`effort` and `maxTokens`. `PanelRequest.reasoning` sets it panel-wide and is
forwarded onto every `WorkerRequest.reasoning`. The default is unset, meaning
provider default, matching upstream.

The CLI exposes `--effort <level>` and `--reasoning-max-tokens <n>` for the
reasoning preference, and `--max-turns <n>` wired to the existing
`WorkerBudget.maxTurns`. `maxToolCalls` stays contract-only until an adapter
can actually map it.

Adapters map these preferences best-effort to their harness. A preference
that a harness cannot honor is never silently dropped: the adapter records a
warning and the effective behavior in compliance evidence.

## Consequences

Callers get the same depth knobs upstream Fusion offers, with the same
neutral defaults. Schemas must be regenerated. The future harness-backed
judge (ADR 0016) receives the same object, so no second effort contract is
needed. Warning-on-unmappable keeps harness capability differences visible
instead of pretending uniform enforcement.
