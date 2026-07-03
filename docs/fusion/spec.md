# Fusion Portable Spec

## Status

Draft

This document sketches the portable Fusion protocol contract. It is
harness-neutral and does not make OpenCode, Claude Code, pi, or any direct API
adapter normative.

## Core Invariants

- Fusion uses neutral workers, not roles or personas.
- Each worker receives the same task prompt and shared context.
- Workers must not see peer outputs or draft synthesis before returning.
- Full compliance requires true independent worker invocations.
- Internal same-agent passes are degraded simulations, not full compliance.
- Harness-specific agents are reference examples, not protocol requirements.

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
  | "pi"
  | "claude-code"
  | "direct-api"
  | string;

type InvocationMode = "headless" | "subagent" | "cli" | "api";

interface PanelRequest {
  panelRunId: string;
  prompt: string;
  sharedContext: SharedContext;
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
  complianceSummary: ComplianceSummary;
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
  compliance: WorkerCompliance;
  warnings?: string[];
  errors?: string[];
}

interface SharedContext {
  text?: string;
  files?: Array<{ path: string; content?: string; digest?: string }>;
  references?: Array<{ label: string; uri?: string; digest?: string }>;
}

interface ContextManifest {
  promptHash: string;
  sharedContextHash: string;
  files?: Array<{ path: string; digest: string }>;
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
  includeToolLogs: boolean;
  includeModelMetadata: boolean;
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
  degradedWorkers?: string[];
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
```

## Notes

The types are intentionally draft-level. They prioritize semantic clarity over
implementation completeness. Adapters may need additional private fields, but
portable behavior should be expressible through this contract.
