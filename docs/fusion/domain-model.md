# Fusion Domain Model

## Aggregate

`PanelRun` is the aggregate root.

It owns worker selection, rendered prompt identity, context identity, worker
invocations, worker results, provenance events, synthesis, and compliance
judgment.

## Entities

### PanelRun

A single Fusion execution for one task. It coordinates workers and produces one
panel result.

### WorkerInvocation

One requested independent worker execution. It includes the rendered prompt,
shared context, session policy, blindness policy, isolation policy, tools policy,
budget, and output contract.

### WorkerResult

The output returned by a worker invocation. It may include adapter metadata,
usage, tool use summary, warnings, errors, and compliance evidence. It does not
authoritatively determine compliance.

### Synthesis

The orchestrator-produced result that compares worker outputs. It records
consensus, contradictions, partial coverage, unique insights, and blind spots.

Important synthesis claims should be attributable to worker outputs when the
synthesis contract requires attribution.

### FinalAnswer

The user-facing answer produced after synthesis. It is grounded in synthesis but
is separate from the comparative synthesis artifact.

### ComplianceJudgment

The orchestrator-derived decision about whether the panel and each worker met
Fusion compliance requirements.

## Value Objects

### ContextManifest

Hashes the rendered worker prompt, shared context, files, and references. It is
required for full compliance.

### ToolsPolicy

Defines the worker tool permissions. The default is read-only and same-by-default
within a panel.

### SessionPolicy

Defines whether a worker uses a fresh, forked, or resumed session.

### HarnessDescriptor

Identifies the harness and invocation mode actually used.

### WorkerPolicy

Defines worker-level behavioral limits. Fusion workers should not recursively
spawn panels, councils, or delegated subtasks by default.

## Domain Events

The event log should record at least these event types:

- `panel.started`
- `context.manifested`
- `harness.selected`
- `worker.invocation.requested`
- `worker.invocation.started`
- `worker.invocation.completed`
- `worker.invocation.failed`
- `synthesis.started`
- `synthesis.completed`
- `compliance.evaluated`

For full compliance, the minimum required event set is:

- `panel.started`
- `context.manifested`
- `harness.selected`
- `worker.invocation.requested` for each worker
- `worker.invocation.started` for each worker
- `worker.invocation.completed` or `worker.invocation.failed` for each worker
- `synthesis.completed` when synthesis is present
- `compliance.evaluated`

`synthesis.started` is recommended, but a missing `synthesis.started` is only a
warning if `synthesis.completed` records the input worker result set.

## Invariants

- Workers in a panel receive the same rendered prompt and shared context.
- Workers do not receive peer outputs, draft synthesis, or panel conclusions
  before returning.
- Workers do not recursively spawn panels, councils, or delegated subtasks unless
  an explicit non-default policy allows it.
- Full compliance requires independent worker invocations.
- Compliance is derived by the orchestrator from evidence.
- Partial synthesis must disclose missing or failed workers.
- Final answers are grounded in synthesis but are distinct from synthesis.
- Missing required provenance events prevent full compliance.
- The event log is a compliance audit log, not a full execution trace.

## Downgrade Rules

- Missing `context.manifested` prevents full compliance because same rendered
  prompt and same shared context cannot be proven.
- Missing `harness.selected` prevents full compliance because harness capability,
  invocation mode, and selection policy cannot be audited.
- Missing worker lifecycle events prevent full compliance for the affected
  worker.
- Missing `compliance.evaluated` prevents full compliance because compliance must
  be orchestrator-derived.
- Missing `synthesis.completed` while synthesis is present degrades the panel.
- Known blindness breaches, peer output exposure, or synthesis before worker
  return make the panel non-compliant.
