# Fusion Portable Spec

## Status

Draft

This document sketches the portable Fusion protocol contract. It is
harness-neutral and does not make OpenCode, Cursor CLI, Claude Code, pi, or any
other concrete harness normative.

## Core Invariants

- Fusion uses neutral workers, not roles or personas.
- Each worker receives the same task prompt and shared context.
- Workers must not see peer outputs or draft synthesis before returning.
- Full compliance requires true independent worker invocations.
- Internal same-agent passes are degraded simulations, not full compliance.
- Harness-specific agents are reference examples, not protocol requirements.

## Reference Harness Policy

The initial reference runtime targets headless worker invocation only. SDK or API
control is preferred over raw CLI control when available because it can provide
stronger session, permission, event, and metadata evidence.

The current reference harness set is `opencode`, `cursor-cli`, `claude-code`, and
`pi`. The reference selector prefers `opencode` by default and prefers
`claude-code` for Claude-family model preferences when available. This is an
overrideable reference policy, not a portable protocol requirement.

If `availableHarnesses` is provided as an empty list, no harness is selectable;
the selector should fail rather than silently choosing a default.

A harness is full-capable only when its adapter can:

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

Harnesses that cannot provide these capabilities may still be used, but the
orchestrator must downgrade compliance or report the missing evidence.

## Reference Skill Execution Path

The bundled CLI entrypoint under `skills/fusion/bin/` is the single canonical
skill execution path (ADR 0014). In both Claude Code and OpenCode, `SKILL.md`
instructs the parent agent to run it through the harness shell tool. Bun is the
required runtime; the runtime keeps zero npm runtime dependencies so the
installed skill directory is self-contained.

The CLI prints a Markdown panel report to stdout by default: status,
compliance tier, and warnings first, then each worker's full output, then the
judge analysis rendered from its structured JSON (or, when the judge did not
run or failed, the reference deterministic synthesis). `--json` switches
stdout to the complete `PanelResult`.

Legacy execution tiers are retired (ADR 0017). Hidden-subagent panels are
removed; `fusion-panelist-*` agents are reference examples only. Same-agent
internal passes survive solely as an emergency fallback when the CLI cannot
run, must announce themselves as degraded simulation before producing results,
and are scheduled for removal consideration once the skill matures.

## Reference Panel Composition Policy

The default panel is three workers; same-harness panels are allowed
(ADR 0015). Default slots, in priority order:

1. the parent agent's own model (a default, not a requirement), conveyed via
   `--parent-model` on the CLI as instructed by `SKILL.md`;
2. the current OpenAI flagship through OpenCode;
3. a cheap-but-capable budget model through OpenCode.

Explicit model selection replaces the default composition entirely. Model
staleness is absorbed by a bundled alias table with ordered fallback lists
(`openai-flagship`, `budget-smart`), using `ModelPreference.fallbacks`.
OpenCode slots verify availability via `opencode models`; Claude Code slots use
the built-in latest aliases plus `--fallback-model` because Claude Code has no
enumeration command.

After resolution, duplicate model IDs are deduplicated and refilled from unused
fallback entries so a default panel always has three distinct models. Repeating
a model is allowed only by explicit selection.

Model entries route to harnesses by pattern (`provider/model` to OpenCode,
Claude aliases to Claude Code, alias-table names via the table), with optional
`opencode:` / `claude-code:` forcing prefixes. Unrecognized entries are errors.
While the harness set is OpenCode and Claude Code, Claude models route
unconditionally to Claude Code.

## Reference Worker Prompt Policy

The orchestrator renders the worker prompt once per panel; adapters send it
verbatim. The rendered prompt is the user task, the portable worker
instructions, and the output contract's required sections, and the
`ContextManifest` hashes this actual rendered prompt (ADR 0020).

The portable worker instructions are the OpenCode panelist norms: neutral
independent panelist framing, no peer coordination, one strong self-contained
answer rather than hedging for a judge, tool use when it materially improves
correctness (primary sources for research, project-local evidence for code),
no file modification, uncertainty preservation, and concise reasoning
summaries instead of hidden chain-of-thought. The required output sections are
a single generic set rendered from `OutputContract.requiredSections`. This is
a deliberate, provisional divergence from upstream OpenRouter Fusion, which
adds no harness instructions; it is recorded and revisitable (ADR 0020).

Shared context enters the CLI through `--context <text>` and repeatable
`--context-file <path>` options. File contents are embedded into
`SharedContext.files` and digested in the manifest; oversized context warns
rather than failing.

Reasoning depth follows upstream semantics (ADR 0021): the optional
`ReasoningPreference` (`effort`, `maxTokens`) is forwarded panel-wide to every
worker call, defaults to provider default with no depth floor, and is exposed
as `--effort` and `--reasoning-max-tokens`. `--max-turns` wires the existing
`WorkerBudget.maxTurns`; `maxToolCalls` stays contract-only until an adapter
can map it. Preferences a harness cannot honor are recorded as warnings, never
silently dropped.

## Reference Worker Tool Policy

The default worker tool policy is read-only local access plus web search and
web fetch where the harness provides them (ADR 0018), matching OpenRouter
Fusion's panelist capability, plus a read-only bash command allowlist (git
inspection and read-only search/listing commands) mirroring the original
OpenCode panelists (ADR 0022). All other shell commands, edit and write
operations, destructive commands, and recursive delegation remain denied by
default. Same-panel tool parity and provenance recording of differences follow
ADR 0006; the opencode adapter's inability to enforce tool policy remains
recorded degraded-compliance evidence.

## Reference Runtime Recording

Fusion does not require durable run artifacts to execute. The reference runtime
uses a `RunRecorder` boundary so callers can choose whether to record audit and
debug artifacts.

The default recorder is no-op. When file recording is explicitly enabled, the
project-local default location is `<workspaceRoot>/.fusion-runs/<panelRunId>/`.
This location treats Fusion run artifacts as project-scoped generated evidence,
not source files.

A recorded run directory should contain split artifacts for auditability and
debugging:

- `request.json`
- `manifest.json`
- `events.jsonl`
- `worker-requests.json`
- `worker-results.json`
- `synthesis.json`
- `compliance.json`
- `result.json`

Run records should be written incrementally so partial evidence survives worker,
synthesis, or process failures. Secret redaction is enabled by default for
recorded artifacts.

Project-local recording requires safety checks. The file recorder should verify
that `.fusion-runs/` is ignored by git or require an explicit override, use
restrictive permissions where possible, avoid raw tool logs by default, and make
recording status visible with states such as `not-recorded`, `partial`,
`complete`, or `failed`.

The first usable integration is library-first: callers compose `runPanel`, the
OpenCode worker runner, the Claude Code worker runner, an optional recorder, and
the deterministic synthesizer. CLI and skill command wrappers are later
ergonomics layers.

The skill should remain an implementation preview until both OpenCode and Claude
Code worker adapters can execute through the same portable library contract.

## Reference Synthesis Policy

The default synthesizer is the harness-backed judge (ADR 0023), mirroring
upstream OpenRouter Fusion's three-stage architecture: the panel answers in
parallel, a separate judge invocation compares all worker outputs without
merging them, and the parent agent (upstream's outer model) writes the final
answer grounded in the judge analysis.

The judge model defaults to the parent model, matching upstream's
judge-defaults-to-outer-model behavior. `--judge-model <model-entry>`
overrides it and resolves through the same model-entry routing as panel
composition; it maps to `SynthesizerPreference.model`. `--synthesizer
parent-agent` and `--synthesizer deterministic` remain implemented but are
explicit-only escapes, never a silent default. The panel-wide timeout and
`ReasoningPreference` also apply to the judge invocation.

The judge invocation reuses the worker adapter path with its own provenance:
`synthesis.started` / `synthesis.completed` carry the judge's strategy,
model, harness, and usage evidence, and recorded runs include the judge
request and result. The judge is not a blind panel worker — it must see all
worker outputs and is reported separately from panel workers in compliance —
but recursion denial still applies to it.

The judge output contract is a superset of the published upstream schema
(ADR 0024): the five-key core (`consensus`, `contradictions` with
`topic`/`stances`, `partial_coverage`, `unique_insights`, `blind_spots`) is
required and validated after tolerant extraction; worker attribution on all
sections and verbatim supporting quotes are optional additive extensions.
Core validation also accepts exactly the documented upstream item shapes —
`partial_coverage` `{models, point}`, `unique_insights` `{model, insight}`,
contradiction stances `{model, stance}` — normalized into the internal
analysis with best-effort worker attribution resolved against the panel's
observed models; other object shapes still fail (ADR 0027). Present quotes
are verified by substring match against worker outputs, with mismatches
recorded as warnings. The judge has no resolution field and runs with no
tools — a deliberate, provisional divergence from upstream, which grants the
judge the panel's web tools; the divergence carries a mandatory re-decision
once the SDK transport provides programmatic permission handling and
enforceable judge tool policy, informed by a measured judge-quality
comparison (ADR 0026). Verification is layered as runtime quote matching plus
the parent agent's own read-tool checks before it writes the final answer.

Judge failure (invocation error, timeout, or invalid core output) follows
upstream semantics: the panel result stays `ok`, the analysis is omitted, the
failure is disclosed as a warning, and the parent agent authors the synthesis
from raw worker outputs as in the pre-judge flow.

The runtime still includes a deterministic fallback synthesizer so a panel can
complete without model-backed synthesis. When the judge succeeds, the
deterministic output is demoted to recorded artifacts only (audit reference);
otherwise it remains in the panel report. It is a stability and testability
mechanism, not the final quality target. Synthesis artifacts identify their
strategy, for example `parent-agent`, `deterministic`, `opencode`, or
`claude-code`.

Partial failure defaults follow OpenRouter semantics (ADR 0019):
`allowPartial: true`, continue with disclosure when at least one worker
succeeds, fail only when all workers fail.

## Reference Schema Policy

JSON Schema is generated from the TypeScript contracts. Runtime schemas used by
the Fusion skill should live under `skills/fusion/schema/` so they are installed
with the skill rather than depending on repository-level files.

## Usable Milestone Acceptance Criteria

The skill is "practically usable" when all of the following are observed, with
the procedure documented for re-execution:

1. From a Claude Code parent, a default skill invocation runs a three-worker
   panel (claude-code x1 + opencode x2) and every worker returns
   `status: "ok"`, with a correct report.
2. From an OpenCode parent, a skill invocation whose selection includes a
   claude-code worker completes with every worker `status: "ok"`.
3. `bun test`, `bun run typecheck:fusion`, and `bun run schema:fusion` pass.
4. A `--record` run writes the split artifact set under
   `<workspaceRoot>/.fusion-runs/<panelRunId>/`.

These are manual smoke checks with real model invocations; CI automation of
this matrix is deferred to a later milestone because it requires credential
management and paid model calls in CI.

## Contract Sketch

```ts
type SessionMode = "fresh" | "fork" | "resume";

type ComplianceTier =
  | "full"
  | "full-reused-isolated-session"
  | "degraded"
  | "non-compliant";

type HarnessKind =
  | "opencode"
  | "cursor-cli"
  | "pi"
  | "claude-code"
  | string;

type InvocationMode = "headless" | "subagent" | "cli" | "api";

interface PanelRequest {
  panelRunId: string;
  prompt: string;
  sharedContext: SharedContext;
  contextManifest: ContextManifest;
  panelSpec: PanelSpec;
  harnessSelectionPolicy: HarnessSelectionPolicy;
  synthesisContract: SynthesisContract;
  synthesizer?: SynthesizerPreference;
  reasoning?: ReasoningPreference;
  provenancePolicy?: ProvenancePolicy;
}

interface SynthesizerPreference {
  strategy: "parent-agent" | "deterministic" | HarnessKind;
  model?: ModelPreference;
}

interface ReasoningPreference {
  effort?: "low" | "medium" | "high" | "xhigh";
  maxTokens?: number;
}

interface PanelResult {
  panelRunId: string;
  status: "ok" | "partial" | "failed";
  workerResults: WorkerResult[];
  synthesis: string;
  finalAnswer?: string;
  complianceSummary: ComplianceSummary;
  events?: ProvenanceEvent[];
  warnings?: string[];
  errors?: string[];
}

interface WorkerRequest {
  panelRunId: string;
  workerId: string;
  prompt: string;
  sharedContext: SharedContext;
  contextManifest?: ContextManifest;
  modelPreference?: ModelPreference;
  harness?: HarnessPreference;
  session: SessionPolicy;
  isolationPolicy: IsolationPolicy;
  blindnessPolicy: BlindnessPolicy;
  workerPolicy: WorkerPolicy;
  toolsPolicy?: ToolsPolicy;
  reasoning?: ReasoningPreference;
  environment?: WorkerEnvironment;
  budget?: WorkerBudget;
  outputContract: OutputContract;
  provenancePolicy?: ProvenancePolicy;
}

interface WorkerResult {
  panelRunId: string;
  workerId: string;
  status: "ok" | "timeout" | "error" | "invalid-output" | "refused";
  output: string;
  modelUsed?: string;
  harnessUsed?: HarnessDescriptor;
  sessionId?: string;
  toolUseSummary?: ToolUseSummary;
  usage?: UsageSummary;
  complianceEvidence?: WorkerComplianceEvidence;
  warnings?: string[];
  errors?: string[];
}

interface SharedContext {
  text?: string;
  files?: Array<{ path: string; content?: string; digest?: string }>;
  references?: Array<{ label: string; uri?: string; digest?: string }>;
}

interface ContextManifest {
  renderedPromptHash: string;
  userTaskHash?: string;
  sharedContextHash: string;
  files?: Array<{ path: string; digest: string }>;
  references?: Array<{ label: string; digest: string }>;
}

interface PanelSpec {
  workerCount: number;
  modelPreferences?: ModelPreference[];
  parentModel?: ModelPreference;
}

interface HarnessSelectionPolicy {
  availableHarnesses?: HarnessKind[];
  requiredCapabilities?: string[];
  userPolicy?: Record<string, unknown>;
}

interface SynthesisContract {
  requiredFindings: Array<
    "consensus" | "contradictions" | "partial-coverage" | "unique-insights" | "blind-spots"
  >;
  format: "markdown" | "json";
  allowPartial: boolean;
  requireAttribution: boolean;
}

interface ModelPreference {
  provider?: string;
  model?: string;
  aliases?: string[];
  fallbacks?: string[];
}

interface HarnessPreference {
  kind?: HarnessKind;
  invocation?: InvocationMode;
  version?: string;
}

interface HarnessDescriptor {
  kind: HarnessKind;
  invocation: InvocationMode;
  version?: string;
}

interface SessionPolicy {
  mode: SessionMode;
  sessionId?: string;
  parentSessionId?: string;
  reusePolicy?: "none" | "same-worker-lineage" | "explicit-user-opt-in";
}

interface IsolationPolicy {
  requireIndependentInvocation: boolean;
  requireIsolatedContext: boolean;
  allowUnverifiedReuse: boolean;
}

interface BlindnessPolicy {
  noPeerOutputs: boolean;
  noDraftSynthesis: boolean;
  noPanelConclusions: boolean;
}

interface WorkerPolicy {
  allowRecursiveDelegation: boolean;
  denyPanelSpawning: boolean;
  denySubtaskDelegation?: boolean;
}

interface ToolsPolicy {
  mode: "none" | "read-only" | "limited" | "full";
  allow?: string[];
  deny?: string[];
  ask?: string[];
  headlessAskBehavior?: "deny" | "error" | "prompt-if-policy-allows";
  parity?: "same-by-default" | "strict-same-required" | "harness-default";
}

interface WorkerEnvironment {
  workspaceRoot?: string;
  workingDirectory?: string;
  envProfile?: string;
}

interface WorkerBudget {
  timeoutMs?: number;
  maxTurns?: number;
  maxToolCalls?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

interface OutputContract {
  format: "markdown" | "json";
  requiredSections?: string[];
  schemaName?: string;
  forbidChainOfThought: boolean;
}

interface ProvenancePolicy {
  record: boolean;
  redactSecrets: boolean;
  eventLog: boolean;
  requireMinimumEventsForFullCompliance: boolean;
  includeToolLogs: boolean;
  includeModelMetadata: boolean;
}

interface ProvenanceEvent {
  eventId: string;
  panelRunId: string;
  workerId?: string;
  type:
    | "panel.started"
    | "context.manifested"
    | "harness.selected"
    | "worker.invocation.requested"
    | "worker.invocation.started"
    | "worker.invocation.completed"
    | "worker.invocation.failed"
    | "synthesis.started"
    | "synthesis.completed"
    | "compliance.evaluated"
    | string;
  timestamp: string;
  data?: Record<string, unknown>;
}

interface WorkerComplianceEvidence {
  adapterClaimsIndependentInvocation?: boolean;
  adapterClaimsIsolatedContext?: boolean;
  adapterClaimsBlindness?: boolean;
  adapterClaimsCleanSameWorkerLineage?: boolean;
  observedSessionMode?: SessionMode;
  observedToolPolicy?: ToolsPolicy;
  notes?: string[];
}

interface WorkerCompliance {
  tier: ComplianceTier;
  independentInvocation: boolean;
  blind: boolean;
  noPeerOutputs: boolean;
  noDraftSynthesis: boolean;
  noPanelConclusions: boolean;
  isolatedContext: boolean;
  sessionMode: SessionMode;
  toolPolicyMatchedPanelDefault?: boolean;
  degradedReason?: string;
}

interface ComplianceSummary {
  tier: ComplianceTier;
  workerCompliance: Array<{ workerId: string; compliance: WorkerCompliance }>;
  degradedWorkers?: string[];
  failedWorkers?: string[];
  missingRequiredEvents?: string[];
  notes?: string[];
}

interface ToolUseSummary {
  toolsUsed?: string[];
  deniedRequests?: string[];
  promptRequests?: string[];
}

interface UsageSummary {
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

const minimumRequiredEventsForFullCompliance = [
  "panel.started",
  "context.manifested",
  "harness.selected",
  "worker.invocation.requested",
  "worker.invocation.started",
  "worker.invocation.completed | worker.invocation.failed",
  "synthesis.completed when synthesis is present",
  "compliance.evaluated",
] as const;
```

## Notes

The types are intentionally draft-level. They prioritize semantic clarity over
implementation completeness. Adapters may need additional private fields, but
portable behavior should be expressible through this contract.

The reference implementation is exposed through `skills/fusion/lib/protocol.ts`
and split across `skills/fusion/lib/*.ts` by responsibility. It does not call any
model provider directly. Instead, it implements the portable orchestration
boundary around injected `runWorker` and `synthesize` adapters.

Compliance is authoritative only when derived by the orchestrator. Worker-level
metadata is evidence, not the final judgment.

Full compliance requires a `ContextManifest`; without it, the orchestrator cannot
prove that workers received the same rendered prompt and shared context.

The rendered prompt is the exact prompt sent to a worker, including task,
portable worker instructions, and output contract. The rendered prompt hash is
the prompt identity boundary for full compliance.

Partial synthesis is allowed when `SynthesisContract.allowPartial` is true. A
partial synthesis must disclose failed workers and avoid presenting partial
agreement as full-panel consensus.

`PanelResult.finalAnswer` is separate from `synthesis`. Synthesis compares and
attributes worker outputs; the final answer is the user-facing response grounded
in that synthesis.

When the synthesis strategy is a harness kind (the default judge), the runtime
records `synthesis.started` / `synthesis.completed` for the judge invocation
itself, with its model, harness, and usage evidence. When the strategy is
`parent-agent` (explicit-only), the runtime records `synthesis.completed` for
the deterministic reference synthesis it produced; the parent-authored
synthesis remains a skill-layer artifact.

Fusion workers should default to `allowRecursiveDelegation: false`,
`denyPanelSpawning: true`, and `denySubtaskDelegation: true`. This preserves the
original non-recursive blind-panel behavior.

When `SynthesisContract.requireAttribution` is true, important synthesis claims
should be traceable to worker outputs or explicitly marked as orchestrator
judgment.

Full compliance requires the minimum provenance events listed above. A missing
`synthesis.started` should produce a warning, not an automatic downgrade, when
`synthesis.completed` records the input worker result set. Detailed tool-call
logs are optional; the event log is a compliance audit log rather than a full
execution trace.

Resumed sessions require explicit clean same-worker lineage evidence to avoid a
compliance downgrade. Partial synthesis should run only when all workers succeed,
or when partial synthesis is allowed and at least one worker succeeds.
