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
  provenancePolicy?: ProvenancePolicy;
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
