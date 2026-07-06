#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  AdapterRegistry,
  ClaudeCodeSdkAdapter,
  ClaudeCodeHeadlessCliAdapter,
  buildWorkerRequests,
  createContextManifest,
  defaultPolicies,
  defaultHarnessSelector,
  DeterministicSynthesizer,
  errorMessage,
  FileRunRecorder,
  HarnessBackedJudgeSynthesizer,
  NoopRunRecorder,
  OpenCodeSdkAdapter,
  OpenCodeHeadlessCliAdapter,
  resolveModelEntry,
  resolvePanelComposition,
  runPanel,
  isImplementedJudgeHarness,
  isNonJudgeSynthesizerStrategy,
  type PanelResult,
  type PanelRequest,
  type ProvenancePolicy,
  type ReasoningPreference,
  type ResolvedPanelComposition,
  type ResolvedPanelModel,
  type RunRecorder,
  type SharedContext,
  type TransportMode,
  type WorkerBudget,
  type WorkerRequest,
  type WorkerRunner,
} from "../lib/protocol";

export interface CliOptions {
  parentModel?: string;
  models?: string[];
  panelists: number;
  panelistsExplicit: boolean;
  context?: string;
  contextFiles: string[];
  readRoots: string[];
  reasoning?: ReasoningPreference;
  maxTurns?: number;
  record: boolean;
  json: boolean;
  transport: TransportMode;
  synthesizer?: string;
  judgeModel?: string;
  timeoutMs?: number;
  prompt: string;
}

export interface PreparedPanelRequest {
  request: PanelRequest;
  workerRequests: WorkerRequest[];
  warnings: string[];
}

const sharedContextWarningCapBytes = 256 * 1024;

export class UsageError extends Error {}

export class HelpRequested extends Error {}

async function main(): Promise<number> {
  try {
    assertBunRuntime();
    const options = parseArgs(Bun.argv.slice(2));
    const prepared = await preparePanelRequest(options, { cwd: process.cwd() });
    const request = prepared.request;

    const recorder: RunRecorder = options.record
      ? new FileRunRecorder({
          workspaceRoot: process.cwd(),
          panelRunId: request.panelRunId,
        })
      : new NoopRunRecorder();
    const runtime = createFusionRuntime(options.transport);
    const result = await runPanelWithRuntime(request, prepared, runtime, recorder);
    if (prepared.warnings.length > 0) {
      result.warnings = [...prepared.warnings, ...(result.warnings ?? [])];
    }

    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(
        renderMarkdownReport(result, {
          recordingStatus: recorder.status,
          synthesizer: request.synthesizer?.strategy ?? "judge",
        }),
      );
    }
    return result.status === "failed" ? 1 : 0;
  } catch (error) {
    if (error instanceof HelpRequested) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    if (error instanceof UsageError) {
      process.stderr.write(`\n${usage()}\n`);
    }
    return 1;
  }
}

export async function preparePanelRequest(
  options: CliOptions,
  input: { cwd?: string; panelRunId?: string } = {},
): Promise<PreparedPanelRequest> {
  const cwd = input.cwd ?? process.cwd();
  const composition = await resolvePanelComposition({
    parentModel: options.parentModel,
    models: options.models,
    panelists: options.panelists,
    panelistsExplicit: options.panelistsExplicit,
    cwd,
  });
  const contextResult = await buildSharedContext(options, cwd);
  const workerBudget = buildWorkerBudget(options);
  const panelRunId = input.panelRunId ?? `fusion-${randomUUID()}`;
  const synthesizerResult = await resolveSynthesizerPreference(
    options,
    composition,
    cwd,
  );
  const requestWithoutManifest = {
    panelRunId,
    prompt: options.prompt,
    sharedContext: contextResult.sharedContext,
    panelSpec: composition.panelSpec,
    harnessSelectionPolicy: composition.harnessSelectionPolicy,
    synthesisContract: {
      requiredFindings: [
        "consensus",
        "contradictions",
        "partial-coverage",
        "unique-insights",
        "blind-spots",
      ],
      format: "markdown",
      allowPartial: true,
      requireAttribution: true,
    },
    synthesizer: synthesizerResult.preference,
    reasoning: options.reasoning,
    workerEnvironment: {
      workspaceRoot: cwd,
      workingDirectory: cwd,
      readRoots: resolveReadRoots(options.readRoots, cwd),
    },
    workerBudget,
    provenancePolicy: provenancePolicy(options.record),
  } satisfies Omit<PanelRequest, "contextManifest">;

  const workerRequests = buildWorkerRequests(requestWithoutManifest);
  const renderedPrompt = renderedPromptFromWorkerRequests(workerRequests);
  const contextManifest = createContextManifest({
    renderedPrompt,
    userTask: options.prompt,
    sharedContext: contextResult.sharedContext,
  });
  const request: PanelRequest = {
    ...requestWithoutManifest,
    contextManifest,
  };
  const manifestedWorkerRequests = workerRequests.map((workerRequest) => ({
    ...workerRequest,
    harness:
      workerRequest.harness === undefined
        ? undefined
        : { ...workerRequest.harness, transport: options.transport },
    contextManifest,
  }));

  return {
    request,
    workerRequests: manifestedWorkerRequests,
    warnings: [
      ...composition.warnings,
      ...contextResult.warnings,
      ...synthesizerResult.warnings,
    ],
  };
}

function renderedPromptFromWorkerRequests(
  workerRequests: WorkerRequest[],
): string {
  const renderedPrompt = workerRequests[0]?.prompt;
  if (renderedPrompt === undefined) {
    throw new Error("Fusion worker request construction produced no workers.");
  }
  return renderedPrompt;
}

export async function buildSharedContext(
  options: Pick<CliOptions, "context" | "contextFiles">,
  cwd: string,
): Promise<{ sharedContext: SharedContext; warnings: string[] }> {
  const files =
    options.contextFiles.length === 0
      ? undefined
      : await Promise.all(
          options.contextFiles.map(async (filePath) => ({
            path: filePath,
            content: await readFile(resolve(cwd, filePath), "utf8"),
          })),
        );
  const sharedContext: SharedContext = {
    text: [`Workspace root: ${cwd}`, options.context]
      .filter((entry): entry is string => entry !== undefined && entry !== "")
      .join("\n\n"),
    files,
  };
  const embeddedContextBytes = embeddedContextSizeBytes(sharedContext);
  const warnings =
    embeddedContextBytes > sharedContextWarningCapBytes
      ? [
          `Shared context is ${embeddedContextBytes} bytes, exceeding the recommended ${sharedContextWarningCapBytes}-byte cap. Workers will still receive it.`,
        ]
      : [];

  return { sharedContext, warnings };
}

function buildWorkerBudget(options: CliOptions): WorkerBudget | undefined {
  const workerBudget: WorkerBudget = {};
  if (options.timeoutMs !== undefined) {
    workerBudget.timeoutMs = options.timeoutMs;
  }
  if (options.maxTurns !== undefined) {
    workerBudget.maxTurns = options.maxTurns;
  }
  return Object.keys(workerBudget).length === 0 ? undefined : workerBudget;
}

function embeddedContextSizeBytes(sharedContext: SharedContext): number {
  return (
    Buffer.byteLength(sharedContext.text ?? "", "utf8") +
    (sharedContext.files ?? []).reduce(
      (total, file) => total + Buffer.byteLength(file.content ?? "", "utf8"),
      0,
    )
  );
}

export function parseArgs(args: string[]): CliOptions {
  const options: Omit<CliOptions, "prompt"> = {
    panelists: 3,
    panelistsExplicit: false,
    contextFiles: [],
    readRoots: [],
    record: false,
    json: false,
    transport: "sdk",
  };
  const promptParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      promptParts.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      promptParts.push(arg, ...args.slice(index + 1));
      break;
    }

    const [flag, inlineValue] = splitFlag(arg);
    // Returns the inline `--flag=value` form or consumes the next argv slot.
    const takeValue = (): string => {
      if (inlineValue !== undefined) {
        if (inlineValue.length === 0) {
          throw new UsageError(`${flag} requires a value.`);
        }
        return inlineValue;
      }
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(`${flag} requires a value.`);
      }
      index += 1;
      return value;
    };

    switch (flag) {
      case "--parent-model":
        options.parentModel = takeValue();
        break;
      case "--models":
        options.models = takeValue()
          .split(",")
          .map((model) => model.trim())
          .filter((model) => model.length > 0);
        if (options.models.length === 0) {
          throw new UsageError("--models must include at least one model.");
        }
        break;
      case "--panelists":
        options.panelists = parsePositiveInteger(flag, takeValue());
        options.panelistsExplicit = true;
        break;
      case "--context":
        options.context = takeValue();
        break;
      case "--context-file":
        options.contextFiles.push(takeValue());
        break;
      case "--read-root":
        options.readRoots.push(takeValue());
        break;
      case "--effort":
        options.reasoning = {
          ...options.reasoning,
          effort: parseReasoningEffort(flag, takeValue()),
        };
        break;
      case "--reasoning-max-tokens":
        options.reasoning = {
          ...options.reasoning,
          maxTokens: parsePositiveInteger(flag, takeValue()),
        };
        break;
      case "--max-turns":
        options.maxTurns = parsePositiveInteger(flag, takeValue());
        break;
      case "--record":
        options.record = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--transport":
        options.transport = parseTransport(flag, takeValue());
        break;
      case "--synthesizer":
        options.synthesizer = takeValue();
        break;
      case "--judge-model":
        options.judgeModel = takeValue();
        break;
      case "--timeout-ms":
        options.timeoutMs = parsePositiveInteger(flag, takeValue());
        break;
      case "--help":
        throw new HelpRequested();
      default:
        throw new UsageError(`Unknown Fusion option: ${flag}`);
    }
  }

  const prompt = promptParts.join(" ").trim();
  if (prompt.length === 0) {
    throw new UsageError("Fusion requires a task prompt.");
  }

  return { ...options, prompt };
}

function parseReasoningEffort(
  flag: string,
  value: string,
): ReasoningPreference["effort"] {
  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }
  throw new UsageError(`${flag} must be one of: low, medium, high, xhigh.`);
}

function parseTransport(flag: string, value: string): TransportMode {
  switch (value) {
    case "sdk":
    case "cli":
      return value;
  }
  throw new UsageError(`${flag} must be one of: sdk, cli.`);
}

function splitFlag(arg: string): [string, string | undefined] {
  const equalsIndex = arg.indexOf("=");
  if (equalsIndex === -1) {
    return [arg, undefined];
  }
  return [arg.slice(0, equalsIndex), arg.slice(equalsIndex + 1)];
}

function parsePositiveInteger(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new UsageError(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function provenancePolicy(record: boolean): ProvenancePolicy {
  return {
    ...defaultPolicies.provenance,
    record,
  };
}

function resolveReadRoots(readRoots: string[], cwd: string): string[] {
  return readRoots.map((root) => resolve(cwd, root));
}

export interface FusionRuntime {
  transport: TransportMode;
  registry: AdapterRegistry;
  runners: {
    opencode: WorkerRunner;
    claudeCode: WorkerRunner;
  };
  dispose(): Promise<void>;
}

export function createFusionRuntime(transport: TransportMode): FusionRuntime {
  switch (transport) {
    case "sdk": {
      const opencode = new OpenCodeSdkAdapter();
      const claudeCode = new ClaudeCodeSdkAdapter();
      return runtimeFromRunners(transport, opencode, claudeCode);
    }
    case "cli": {
      const opencode = new OpenCodeHeadlessCliAdapter();
      const claudeCode = new ClaudeCodeHeadlessCliAdapter();
      return runtimeFromRunners(transport, opencode, claudeCode);
    }
  }
}

function runtimeFromRunners(
  transport: TransportMode,
  opencode: WorkerRunner,
  claudeCode: WorkerRunner,
): FusionRuntime {
  return {
    transport,
    registry: new AdapterRegistry({ transport })
      .register("opencode", opencode)
      .register("claude-code", claudeCode),
    runners: { opencode, claudeCode },
    async dispose() {
      await disposeRunner(opencode);
      await disposeRunner(claudeCode);
    },
  };
}

async function disposeRunner(runner: WorkerRunner): Promise<void> {
  const disposable = runner as WorkerRunner & {
    dispose?: () => Promise<void> | void;
  };
  await disposable.dispose?.();
}

async function runPanelWithRuntime(
  request: PanelRequest,
  prepared: PreparedPanelRequest,
  runtime: FusionRuntime,
  recorder: RunRecorder,
): Promise<PanelResult> {
  try {
    return await runPanel(request, {
      runner: runtime.registry,
      harnessSelector: runtime.registry,
      workerRequests: withHarnessTransport(
        prepared.workerRequests,
        runtime.transport,
      ),
      synthesizer: createSynthesizer(
        request.synthesizer?.strategy,
        runtime.registry,
      ),
      recorder,
    });
  } finally {
    await runtime.dispose();
  }
}

function withHarnessTransport(
  workerRequests: WorkerRequest[],
  transport: TransportMode,
): WorkerRequest[] {
  return workerRequests.map((request) => ({
    ...request,
    harness:
      request.harness === undefined
        ? undefined
        : { ...request.harness, transport },
  }));
}

function createSynthesizer(
  strategy: NonNullable<PanelRequest["synthesizer"]>["strategy"] | undefined,
  registry: AdapterRegistry,
): DeterministicSynthesizer | HarnessBackedJudgeSynthesizer {
  if (isNonJudgeSynthesizerStrategy(strategy)) {
    return new DeterministicSynthesizer();
  }

  return new HarnessBackedJudgeSynthesizer({
    runner: registry,
    harnessSelector: registry,
  });
}

async function resolveSynthesizerPreference(
  options: CliOptions,
  composition: ResolvedPanelComposition,
  cwd: string,
): Promise<{
  preference: NonNullable<PanelRequest["synthesizer"]>;
  warnings: string[];
}> {
  if (isNonJudgeSynthesizerStrategy(options.synthesizer)) {
    if (options.judgeModel !== undefined) {
      throw new UsageError(
        "--judge-model only applies to the harness-backed judge synthesizer.",
      );
    }
    return { preference: { strategy: options.synthesizer }, warnings: [] };
  }

  if (
    options.synthesizer !== undefined &&
    !isImplementedJudgeHarness(options.synthesizer)
  ) {
    throw new UsageError(
      `Synthesizer strategy "${options.synthesizer}" is not implemented by this CLI.`,
    );
  }

  const explicitStrategy = options.synthesizer;
  const resolved = await resolveJudgeModel(options, composition, cwd);
  if (resolved !== undefined) {
    const strategy = explicitStrategy ?? resolved.harness;
    if (strategy !== resolved.harness) {
      const modelSource =
        options.judgeModel !== undefined ? "Judge model" : "Parent model";
      const modelEntry = options.judgeModel ?? options.parentModel;
      throw new UsageError(
        `${modelSource} "${modelEntry}" routes to ${resolved.harness}, which conflicts with --synthesizer ${strategy}.`,
      );
    }
    return {
      preference: { strategy, model: resolved.modelPreference },
      warnings: [],
    };
  }

  const harness = defaultHarnessSelector.selectHarness({
    workerId: "judge",
    policy: composition.harnessSelectionPolicy,
  }).kind;
  return {
    preference: { strategy: explicitStrategy ?? harness },
    warnings: [
      "No --parent-model or --judge-model was provided; the judge will use the selected harness default model.",
    ],
  };
}

async function resolveJudgeModel(
  options: CliOptions,
  composition: ResolvedPanelComposition,
  cwd: string,
): Promise<ResolvedPanelModel | undefined> {
  if (options.judgeModel !== undefined) {
    return resolveModelEntry(options.judgeModel, {
      cwd,
      opencodeModels: knownOpenCodeModels(composition),
    });
  }

  if (options.parentModel === undefined) {
    return undefined;
  }

  const parentSlot = composition.resolvedModels.find(
    (model) => model.slot === "parent",
  );
  if (parentSlot !== undefined) {
    return parentSlot;
  }

  return resolveModelEntry(options.parentModel, {
    cwd,
    opencodeModels: knownOpenCodeModels(composition),
  });
}

function knownOpenCodeModels(
  composition: ResolvedPanelComposition,
): string[] | undefined {
  return composition.opencodeModels.length === 0
    ? undefined
    : composition.opencodeModels;
}

export function renderMarkdownReport(
  result: PanelResult,
  options: { recordingStatus: string; synthesizer: string },
): string {
  const parentMustAuthor = result.finalAnswer === undefined;
  const strategy = result.strategy ?? options.synthesizer;
  const renderedJudgeAnalysis =
    strategy !== undefined && !isNonJudgeSynthesizerStrategy(strategy);
  const warnings = result.warnings ?? [];
  const errors = result.errors ?? [];
  const lines = [
    "# Fusion Panel Report",
    "",
    `- Run status: ${result.status}`,
    `- Compliance tier: ${result.complianceSummary.tier}`,
    `- Synthesizer option: ${options.synthesizer}`,
  ];
  const judgeCompliance = result.complianceSummary.judgeCompliance;
  if (judgeCompliance !== undefined) {
    lines.push(`- ${renderJudgeStatusLine(result)}`);
  }
  if (parentMustAuthor) {
    lines.push(
      "- Final answer: unset; the parent agent must author the final answer from this report.",
    );
  }
  lines.push("");

  lines.push("## Warnings");
  lines.push(
    warnings.length === 0
      ? "None."
      : warnings.map((warning) => `- ${warning}`).join("\n"),
  );
  lines.push("");

  if (errors.length > 0) {
    lines.push("## Errors");
    lines.push(errors.map((error) => `- ${error}`).join("\n"));
    lines.push("");
  }

  lines.push("## Workers");
  for (const worker of result.workerResults) {
    lines.push(
      "",
      `### ${worker.workerId}`,
      "",
      `- Model: ${worker.modelUsed ?? "unknown"}`,
      `- Harness: ${worker.harnessUsed?.kind ?? "unknown"}`,
      `- Status: ${worker.status}`,
    );
    if (worker.errors !== undefined && worker.errors.length > 0) {
      lines.push(`- Errors: ${worker.errors.join("; ")}`);
    }
    if (worker.warnings !== undefined && worker.warnings.length > 0) {
      lines.push(`- Warnings: ${worker.warnings.join("; ")}`);
    }
    lines.push("", worker.output.trim() || "[no output]", "");
  }

  const synthesisLabel = renderedJudgeAnalysis
    ? "## Judge Analysis"
    : parentMustAuthor
      ? "## Reference Deterministic Synthesis (Audit Reference)"
      : "## Deterministic Synthesis";
  const synthesisStrategy = renderedJudgeAnalysis
    ? `Strategy: ${strategy}.`
    : `Strategy: ${strategy ?? "deterministic"}${parentMustAuthor ? "; audit reference only" : ""}.`;
  lines.push(
    synthesisLabel,
    "",
    synthesisStrategy,
    "",
    result.synthesis.trim() || "[no synthesis]",
    "",
    "## Recording",
    "",
    `Status: ${options.recordingStatus}`,
    "",
  );

  return `${lines.join("\n")}\n`;
}

function renderJudgeStatusLine(result: PanelResult): string {
  const judgeCompliance = result.complianceSummary.judgeCompliance;
  if (judgeCompliance === undefined) {
    return "Judge: not-run";
  }
  const status =
    judgeCompliance.status === "ok" &&
    result.analysis === undefined &&
    result.fallbackReason !== undefined
      ? "invocation ok, output failed validation (fell back to parent-agent)"
      : (judgeCompliance.status ?? "not-returned");
  return `Judge: ${status} via ${judgeCompliance.harnessUsed?.kind ?? "unknown"} (${judgeCompliance.modelUsed ?? "unknown model"})`;
}

function assertBunRuntime(): void {
  if (typeof Bun === "undefined") {
    throw new UsageError(
      "Fusion requires Bun. Install Bun from https://bun.sh/docs/installation and rerun with `bun skills/fusion/bin/fusion-run.ts`.",
    );
  }
}

export function usage(): string {
  return [
    'Usage: bun skills/fusion/bin/fusion-run.ts [options] "task prompt"',
    "",
    "Options:",
    "  --parent-model <id>       Parent agent model id for the default panel slot.",
    "  --models <comma-list>     Explicit model list; replaces default composition.",
    "  --panelists <n>           Default panel size (default: 3).",
    "  --context <text>          Shared context brief for every worker.",
    "  --context-file <path>     Embed a file into shared context; repeatable.",
    "  --read-root <path>        Grant workers recursive read access to a directory; repeatable.",
    "  --effort <level>          Worker reasoning effort: low, medium, high, or xhigh.",
    "  --reasoning-max-tokens <n>",
    "                            Worker reasoning token budget.",
    "  --max-turns <n>           Per-worker turn budget where supported.",
    "  --record                  Write .fusion-runs/<panelRunId>/ artifacts.",
    "  --json                    Print complete PanelResult JSON.",
    "  --transport <mode>        Worker transport: sdk or cli (default: sdk).",
    "  --judge-model <entry>     Override the default parent-model judge.",
    "  --synthesizer <strategy>  parent-agent, deterministic, opencode, or claude-code.",
    "  --timeout-ms <n>          Per-worker timeout.",
  ].join("\n");
}

if (import.meta.main) {
  process.exitCode = await main();
}
