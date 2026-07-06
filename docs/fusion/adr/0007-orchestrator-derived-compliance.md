# ADR 0007: Derive Compliance In The Orchestrator

## Status

Accepted

## Context

Compliance depends on properties outside a worker's reliable knowledge: how it
was invoked, what context was supplied to peers, whether peer outputs were
withheld, which tools were available, and whether session reuse was clean.

If workers self-report compliance, the trust boundary is unclear and adapters may
accidentally treat an assertion as evidence.

## Decision

Compliance is derived by the orchestrator from invocation evidence, adapter
metadata, context manifests, session metadata, and worker results.

Workers may return local observations or warnings, but they do not determine the
final compliance tier.

Full compliance requires a context manifest that identifies the prompt, shared
context, and supplied file/reference digests.

## Consequences

`WorkerResult` should carry compliance evidence or warnings, while `PanelResult`
contains the authoritative compliance summary.

Adapters must expose enough metadata for the orchestrator to determine whether
independence, blindness, isolation, and tool policy requirements were met.

If evidence is missing, the orchestrator must downgrade or warn rather than infer
full compliance.
