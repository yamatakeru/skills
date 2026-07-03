# ADR 0002: Use Fresh Worker Sessions By Default

## Status

Accepted

## Context

Fusion should support headless harness invocation and may support session reuse
when a harness can address prior sessions. Session reuse is useful for retries,
follow-up work, and reducing setup overhead, but it can also break the blind
panel contract if a worker sees peer outputs or prior synthesis.

## Decision

The default session mode for Fusion workers is `fresh`.

Fusion recognizes three session modes:

- `fresh`: start a new worker session with no prior panel state.
- `fork`: start from a sanitized bootstrap session that contains no worker
  outputs, no synthesis, and no panel conclusions.
- `resume`: continue an existing worker session.

`resume` can only be considered full-compliance-compatible when the
implementation can prove that the resumed session belongs to the same worker
lineage and has not seen peer worker outputs, draft synthesis, or prior panel
conclusions for the task.

If those conditions cannot be proven, `resume` is allowed only as a degraded
mode and must be disclosed in compliance metadata.

## Consequences

Session reuse is part of the portable design vocabulary, but it is not the
default behavior.

Harness adapters must report the session mode used and whether isolation and
blindness were technically guaranteed, inferred, or unverified.

The orchestrator must not silently treat arbitrary resumed sessions as equivalent
to fresh independent workers.

## Compliance Guidance

- `fresh` with separate worker invocation can satisfy full compliance.
- `fork` can satisfy full compliance only when the bootstrap contains no panel
  outputs, synthesis, or conclusions.
- `resume` can satisfy full compliance only with proven clean same-worker
  lineage.
- Unverified session reuse is degraded.
