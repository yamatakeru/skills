# ADR 0010: Require Minimum Provenance Events For Full Compliance

## Status

Accepted

## Context

Fusion uses an event log as the audit trail for compliance. The log should be
strong enough to prove the core properties of Fusion without becoming a complete
trace of every implementation detail.

The minimum required events should let an auditor verify same input, harness
selection, independent worker invocation, terminal worker status, synthesis
provenance, and orchestrator-derived compliance.

## Decision

Full compliance requires these provenance events:

- `panel.started`
- `context.manifested`
- `harness.selected`
- `worker.invocation.requested` for each worker
- `worker.invocation.started` for each worker
- `worker.invocation.completed` or `worker.invocation.failed` for each worker
- `synthesis.completed` when synthesis is present
- `compliance.evaluated`

`synthesis.started` should be recorded when possible, but it is not a hard
requirement for worker independence. If `synthesis.completed` records the input
worker result set, a missing `synthesis.started` is a warning rather than an
automatic downgrade.

The event log is a compliance audit log, not a full execution trace. Detailed
tool calls may be recorded separately, but they are not required events for full
compliance.

## Downgrade Rules

If `context.manifested` is missing, full compliance is impossible because the
orchestrator cannot prove same rendered prompt and same shared context.

If `harness.selected` is missing, full compliance is impossible because the
orchestrator cannot verify harness capability, invocation mode, or selection
policy.

If any worker is missing `worker.invocation.requested`,
`worker.invocation.started`, or a terminal worker event, that worker cannot be
fully compliant.

If `compliance.evaluated` is missing, the panel cannot be fully compliant because
compliance must be orchestrator-derived.

If synthesis exists but `synthesis.completed` is missing, the panel is degraded
because the synthesis cannot be audited.

Known blindness breaches, peer output exposure, synthesis before worker return,
or a complete inability to evaluate compliance make the panel non-compliant.

Failed workers do not prevent partial synthesis, but the panel result must be
`partial` and must disclose the missing or failed workers.

## Consequences

The required event set stays small and implementation-neutral.

Full compliance depends on auditability of the Fusion invariants, not on logging
every tool call or harness-internal step.
