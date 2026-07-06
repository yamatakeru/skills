export type SessionMode = "fresh" | "fork" | "resume";

export type ComplianceTier =
  "full" | "full-reused-isolated-session" | "degraded" | "non-compliant";

type ExtensibleString = string & {};

export type HarnessKind =
  "opencode" | "cursor-cli" | "claude-code" | "pi" | ExtensibleString;
export type InvocationMode = "headless" | "subagent";
export type TransportMode = "cli" | "sdk";
export type PanelStatus = "ok" | "partial" | "failed";
export type WorkerStatus =
  "ok" | "timeout" | "error" | "invalid-output" | "refused";
export type NonJudgeSynthesizerStrategy = "parent-agent" | "deterministic";
export type ImplementedJudgeHarness = "opencode" | "claude-code";

export type FindingKind =
  | "consensus"
  | "contradictions"
  | "partial-coverage"
  | "unique-insights"
  | "blind-spots";

export interface PanelRequest {
  panelRunId: string;
  prompt: string;
  sharedContext: SharedContext;
  contextManifest: ContextManifest;
  panelSpec: PanelSpec;
  harnessSelectionPolicy: HarnessSelectionPolicy;
  synthesisContract: SynthesisContract;
  synthesizer?: SynthesizerPreference;
  reasoning?: ReasoningPreference;
  workerEnvironment?: WorkerEnvironment;
  workerBudget?: WorkerBudget;
  provenancePolicy?: ProvenancePolicy;
}

export interface SynthesizerPreference {
  strategy: NonJudgeSynthesizerStrategy | HarnessKind;
  model?: ModelPreference;
}

export interface ReasoningPreference {
  effort?: "low" | "medium" | "high" | "xhigh";
  maxTokens?: number;
}

export interface PanelResult {
  panelRunId: string;
  status: PanelStatus;
  workerResults: WorkerResult[];
  analysis?: JudgeAnalysis;
  synthesis: string;
  finalAnswer?: string;
  strategy?: string;
  fallbackReason?: string;
  complianceSummary: ComplianceSummary;
  events?: ProvenanceEvent[];
  warnings?: string[];
  errors?: string[];
}

export interface WorkerRequest {
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

export interface WorkerResult {
  panelRunId: string;
  workerId: string;
  status: WorkerStatus;
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

export interface SharedContext {
  text?: string;
  files?: Array<{ path: string; content?: string; digest?: string }>;
  references?: Array<{ label: string; uri?: string; digest?: string }>;
}

export interface ContextManifest {
  renderedPromptHash: string;
  userTaskHash?: string;
  sharedContextHash: string;
  files?: Array<{ path: string; digest: string }>;
  references?: Array<{ label: string; digest: string }>;
}

export interface PanelSpec {
  /**
   * Kept in sync with MAX_PANEL_WORKERS in validation.ts.
   * @minimum 1
   * @maximum 20
   */
  workerCount: number;
  modelPreferences?: ModelPreference[];
  parentModel?: ModelPreference;
}

export interface HarnessSelectionPolicy {
  availableHarnesses?: HarnessKind[];
  requiredCapabilities?: string[];
  userPolicy?: Record<string, unknown>;
}

export interface SynthesisContract {
  requiredFindings: FindingKind[];
  format: "markdown" | "json";
  allowPartial: boolean;
  requireAttribution: boolean;
}

export interface JudgeAnalysis {
  consensus: JudgeFinding[];
  contradictions: JudgeContradiction[];
  partial_coverage: JudgeFinding[];
  unique_insights: JudgeFinding[];
  blind_spots: JudgeFinding[];
}

export type JudgeFinding = string | JudgeAnnotatedFinding;

export interface JudgeAnnotatedFinding {
  text: string;
  attribution?: JudgeAttribution[];
  quotes?: JudgeQuote[];
}

export interface JudgeAttribution {
  workerId: string;
  modelUsed?: string;
}

export interface JudgeQuote {
  workerId: string;
  quote: string;
}

export interface JudgeContradiction {
  topic: string;
  stances: JudgeStances;
  attribution?: JudgeAttribution[];
  quotes?: JudgeQuote[];
}

export type JudgeStances = Record<string, string> | JudgeStance[];

export type JudgeStance = string | JudgeAttributedStance;

export interface JudgeAttributedStance {
  stance: string;
  workerId?: string;
  modelUsed?: string;
  attribution?: JudgeAttribution[];
  quotes?: JudgeQuote[];
}

export interface ModelPreference {
  provider?: string;
  model?: string;
  aliases?: string[];
  fallbacks?: string[];
}

export interface HarnessPreference {
  kind?: HarnessKind;
  invocation?: InvocationMode;
  transport?: TransportMode;
  version?: string;
}

export interface HarnessDescriptor {
  kind: HarnessKind;
  invocation: InvocationMode;
  transport?: TransportMode;
  version?: string;
}

export interface SessionPolicy {
  mode: SessionMode;
  sessionId?: string;
  parentSessionId?: string;
  reusePolicy?: "none" | "same-worker-lineage" | "explicit-user-opt-in";
}

export interface IsolationPolicy {
  requireIndependentInvocation: boolean;
  requireIsolatedContext: boolean;
  allowUnverifiedReuse: boolean;
}

export interface BlindnessPolicy {
  noPeerOutputs: boolean;
  noDraftSynthesis: boolean;
  noPanelConclusions: boolean;
}

export interface WorkerPolicy {
  allowRecursiveDelegation: boolean;
  denyPanelSpawning: boolean;
  denySubtaskDelegation?: boolean;
}

export interface ToolsPolicy {
  mode: "none" | "read-only" | "limited" | "full";
  allow?: string[];
  deny?: string[];
  ask?: string[];
  readOnlyBashCommands?: string[];
  headlessAskBehavior?: "deny" | "error" | "prompt-if-policy-allows";
  parity?: "same-by-default" | "strict-same-required" | "harness-default";
}

export interface WorkerEnvironment {
  workspaceRoot?: string;
  workingDirectory?: string;
  readRoots?: string[];
  envProfile?: string;
}

export interface WorkerBudget {
  timeoutMs?: number;
  maxTurns?: number;
  maxToolCalls?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export interface OutputContract {
  format: "markdown" | "json";
  requiredSections?: string[];
  schemaName?: string;
  forbidChainOfThought: boolean;
}

export interface ProvenancePolicy {
  record: boolean;
  redactSecrets: boolean;
  eventLog: boolean;
  requireMinimumEventsForFullCompliance: boolean;
  includeToolLogs: boolean;
  includeModelMetadata: boolean;
}

export interface ProvenanceEvent {
  eventId: string;
  panelRunId: string;
  workerId?: string;
  type: ProvenanceEventType | ExtensibleString;
  timestamp: string;
  data?: Record<string, unknown>;
}

export type ProvenanceEventType =
  | "panel.started"
  | "context.manifested"
  | "harness.selected"
  | "worker.invocation.requested"
  | "worker.invocation.started"
  | "worker.invocation.completed"
  | "worker.invocation.failed"
  | "synthesis.started"
  | "synthesis.completed"
  | "compliance.evaluated";

export interface WorkerComplianceEvidence {
  adapterClaimsIndependentInvocation?: boolean;
  adapterClaimsIsolatedContext?: boolean;
  adapterClaimsBlindness?: boolean;
  adapterClaimsCleanSameWorkerLineage?: boolean;
  observedSessionMode?: SessionMode;
  observedToolPolicy?: ToolsPolicy;
  notes?: string[];
}

export interface WorkerCompliance {
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

export interface ComplianceSummary {
  tier: ComplianceTier;
  workerCompliance: Array<{ workerId: string; compliance: WorkerCompliance }>;
  judgeCompliance?: JudgeCompliance;
  degradedWorkers?: string[];
  failedWorkers?: string[];
  missingRequiredEvents?: string[];
  notes?: string[];
}

export interface JudgeCompliance {
  workerId: string;
  status?: WorkerStatus;
  modelUsed?: string;
  harnessUsed?: HarnessDescriptor;
  toolsPolicy?: ToolsPolicy;
  notes?: string[];
}

export interface ToolUseSummary {
  toolsUsed?: string[];
  deniedRequests?: string[];
  promptRequests?: string[];
}

export interface UsageSummary {
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface SynthesisResult {
  analysis?: JudgeAnalysis;
  synthesis: string;
  finalAnswer?: string;
  strategy?: string;
  judgeRequest?: WorkerRequest;
  judgeResult?: WorkerResult;
  referenceSynthesis?: string;
  fallbackReason?: string;
  warnings?: string[];
  errors?: string[];
}

export interface WorkerRunner {
  runWorker(request: WorkerRequest): Promise<WorkerResult>;
}

export interface Synthesizer {
  synthesize(input: SynthesisInput): Promise<SynthesisResult>;
}

export interface SynthesisInput {
  panelRequest: PanelRequest;
  workerRequests: WorkerRequest[];
  workerResults: WorkerResult[];
  events: ProvenanceEvent[];
}

export interface HarnessSelector {
  selectHarness(input: HarnessSelectionInput): HarnessDescriptor;
}

export interface HarnessSelectionInput {
  workerId: string;
  modelPreference?: ModelPreference;
  policy: HarnessSelectionPolicy;
}

export type RecordingStatus =
  "not-recorded" | "partial" | "complete" | "failed";

export interface RunRecorder {
  readonly status: RecordingStatus;
  recordRequest?(request: PanelRequest): Promise<void> | void;
  recordManifest?(manifest: ContextManifest): Promise<void> | void;
  recordEvent?(event: ProvenanceEvent): Promise<void> | void;
  recordWorkerRequests?(requests: WorkerRequest[]): Promise<void> | void;
  recordWorkerResults?(results: WorkerResult[]): Promise<void> | void;
  recordSynthesis?(result: SynthesisResult): Promise<void> | void;
  recordCompliance?(summary: ComplianceSummary): Promise<void> | void;
  recordResult?(result: PanelResult): Promise<void> | void;
}

export interface PanelRunOptions {
  runner: WorkerRunner;
  synthesizer: Synthesizer;
  harnessSelector?: HarnessSelector;
  workerRequests?: WorkerRequest[];
  recorder?: RunRecorder;
  defaults?: Partial<DefaultPolicies>;
  now?: () => Date;
  idFactory?: () => string;
}

export interface DefaultPolicies {
  session: SessionPolicy;
  isolation: IsolationPolicy;
  blindness: BlindnessPolicy;
  worker: WorkerPolicy;
  tools: ToolsPolicy;
  output: OutputContract;
  provenance: ProvenancePolicy;
}

export const minimumRequiredEventsForFullCompliance = [
  "panel.started",
  "context.manifested",
  "harness.selected",
  "worker.invocation.requested",
  "worker.invocation.started",
  "worker.invocation.completed | worker.invocation.failed",
  "synthesis.completed when synthesis is present",
  "compliance.evaluated",
] as const;

export function isNonJudgeSynthesizerStrategy(
  strategy: string | undefined,
): strategy is NonJudgeSynthesizerStrategy {
  return strategy === "parent-agent" || strategy === "deterministic";
}

export function isImplementedJudgeHarness(
  strategy: string | undefined,
): strategy is ImplementedJudgeHarness {
  return strategy === "opencode" || strategy === "claude-code";
}

export function isHarnessSynthesizerStrategy(
  strategy: SynthesizerPreference["strategy"] | undefined,
): strategy is HarnessKind {
  return strategy !== undefined && !isNonJudgeSynthesizerStrategy(strategy);
}
