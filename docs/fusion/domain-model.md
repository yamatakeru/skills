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

The default author is the harness-backed judge: a separate invocation through
the worker adapter path that compares worker outputs without merging them and
returns the structured judge analysis (upstream five-key core plus optional
attribution and quote extensions; documented upstream item shapes are
accepted and normalized with best-effort attribution, ADR 0027). The judge
sees all worker outputs, so blindness does not apply to it, but recursion
denial does; it runs with no tools — a deliberate, provisional divergence
from upstream's web-tools judge with a mandatory re-decision once the SDK
transport lands (ADR 0026) — and records its own provenance and evidence.
Judge failure keeps the panel `ok` with the analysis omitted and disclosed,
degrading to parent-agent authorship. `parent-agent` and `deterministic`
remain explicit-only strategies; the deterministic synthesizer is an audit
reference and fallback, not the final answer-quality target (ADR 0023/0024).

### FinalAnswer

The user-facing answer produced after synthesis. It is grounded in synthesis but
is separate from the comparative synthesis artifact.

### ComplianceJudgment

The orchestrator-derived decision about whether the panel and each worker met
Fusion compliance requirements.

### RunRecorder

The optional recording boundary for a `PanelRun`. A recorder observes request,
manifest, event log, worker requests, worker results, synthesis, compliance, and
final result artifacts. The default recorder is no-op. The reference file
recorder writes project-local artifacts under
`<workspaceRoot>/.fusion-runs/<panelRunId>/` when explicitly enabled.

## Value Objects

### PanelCompositionPolicy

The rules that turn an option-less invocation into a concrete worker set: the
default three slots (parent model, flagship, budget), the bundled model alias
table with ordered fallbacks, availability checks per harness, and
deduplication by resolved model ID with refill. Explicit user selection
replaces the default composition.

### SynthesizerPreference

Identifies who authors the synthesis: a harness kind for the harness-backed
judge (default), or the explicit-only `parent-agent` and `deterministic`
strategies. Its `model` field carries the judge model preference, defaulting
to the parent model.

### ReasoningPreference

The optional panel-wide reasoning configuration (`effort`, `maxTokens`)
forwarded to every worker invocation, mirroring OpenRouter Fusion's
`reasoning` parameter. Unset means provider default. Adapters map it
best-effort and record a warning when the harness cannot honor it.

### ContextManifest

Hashes the rendered worker prompt, shared context, files, and references. It is
required for full compliance.

### ToolsPolicy

Defines the worker tool permissions. The default is read-only local access, a
read-only bash command allowlist (git inspection plus read-only search and
listing commands), and web search and web fetch where the harness provides
them, same-by-default within a panel. All other shell commands, edit, write,
and recursive delegation remain denied by default.

### SessionPolicy

Defines whether a worker uses a fresh, forked, or resumed session.

### HarnessDescriptor

Identifies the harness and invocation mode actually used.

### HarnessCapability

Describes whether a harness adapter can satisfy the minimum evidence and policy
requirements for full compliance. Harness capability is adapter evidence, not a
portable domain entity.

### WorkerPolicy

Defines worker-level behavioral limits. Fusion workers should not recursively
spawn panels, councils, or delegated subtasks by default.

## Full-Capable Harness Criteria

A harness adapter is full-capable only when it can:

- create or prove a fresh worker session;
- observe and report the actual model used;
- record rendered prompt and shared context identity through the
  `ContextManifest`;
- apply the requested read-only tool policy as an effective harness policy;
- deny edit and write operations;
- deny recursive delegation, including subagents, panels, or delegated subtasks;
- resolve headless approval requests as deny or structured error by default;
- capture worker output and tool events;
- record session or run id, usage, errors, and relevant harness metadata.

OpenCode and Claude Code are the first full-capable reference targets. Cursor CLI
and pi are useful candidates, but should be treated as conditional or degraded
until their adapters prove equivalent policy enforcement and evidence.

The first usable reference runtime requires both OpenCode and Claude Code worker
adapters to exercise the same portable `WorkerRequest` to `WorkerResult`
contract. Implementing only one of them is an implementation preview, not the
usable milestone.

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

## Recording Invariants

- Recording is optional; missing recorded files do not prevent Fusion execution.
- A recorded run directory belongs to exactly one `PanelRun`.
- `events.jsonl` is written incrementally when file recording is enabled.
- Summary artifacts may be rewritten as the run advances, but should represent
  the latest known state.
- Recorded artifacts redact secrets by default.
- Project-local recording requires safety checks such as git-ignore verification
  or an explicit override.
- Missing recording does not by itself determine protocol compliance, but it
  limits auditability for the reference runtime.
- A successful worker result with incomplete harness evidence may still be
  returned, recorded when recording is enabled, and synthesized, but compliance
  must be downgraded rather than reported as full.

## Invariants

- The bundled CLI is the canonical skill execution path; same-agent internal
  simulation is an emergency fallback that must announce itself as degraded
  before producing results.
- The orchestrator renders the worker prompt once per panel (user task,
  portable worker instructions, output contract sections); adapters send it
  verbatim, and the `ContextManifest` hashes the actual rendered prompt.
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
- Missing harness evidence for fresh session, observed model, effective tool
  policy, edit/write denial, recursive delegation denial, headless ask handling,
  output capture, or run metadata prevents full compliance.
