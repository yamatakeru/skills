# ADR 0009: Use Event Log Provenance

## Status

Accepted

## Context

Fusion compliance is derived by the orchestrator. To derive and audit compliance,
the orchestrator needs more than a final summary: it needs evidence of harness
selection, worker invocation, supplied context, session handling, tool policy,
worker completion, synthesis, and compliance decisions.

## Decision

Fusion treats provenance as an event log at the `PanelRun` level.

The event log records the important lifecycle events of a panel run. It is the
primary audit trail for compliance and reproducibility.

Full compliance uses the rendered worker prompt as the prompt identity boundary.
The rendered prompt is the exact prompt sent to a worker, including task,
portable worker instructions, and output contract.

## Consequences

The protocol can explain how compliance was determined, not only what compliance
was reported.

Adapters and orchestrators should avoid relying on harness defaults that are not
represented in the event log.

Prompt hashes must refer to rendered worker prompts. Implementations may also
record the original user task hash, but it is not sufficient for proving worker
input equality.
