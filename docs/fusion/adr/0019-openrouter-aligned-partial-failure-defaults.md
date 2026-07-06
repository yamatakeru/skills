# ADR 0019: OpenRouter-Aligned Partial Failure Defaults

## Status

Accepted

Extends ADR 0008.

## Context

ADR 0008 permits partial synthesis but left the default posture to
implementations. Real CLI workers fail for mundane reasons (timeouts,
authentication, transient provider errors), and a strict all-or-nothing default
would discard paid worker results and make the skill brittle. OpenRouter Fusion
returns `ok` when at least one panelist succeeds, records failures in
`failed_models`, and only errors when every panelist fails.

## Decision

The reference runtime defaults to `allowPartial: true` with OpenRouter-aligned
semantics:

- at least one successful worker: the run continues with
  `PanelResult.status: "partial"`, and the report lists each failed worker with
  its failure reason;
- all workers fail: the run is `failed` with the collected errors.

Disclosure rules from ADR 0008 are unchanged: partial results must not be
presented as full-panel consensus, and the parent-authored synthesis and final
answer must acknowledge missing workers.

## Consequences

Single-worker misbehavior degrades a run instead of wasting it. Compliance and
status reporting carry the honesty burden: `partial` runs are visibly partial
in the report header, per-worker status, and recorded artifacts.
