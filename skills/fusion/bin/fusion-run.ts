#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  AdapterRegistry,
  ClaudeCodeHeadlessCliAdapter,
  buildWorkerRequests,
  createContextManifest,
  defaultPolicies,
  DeterministicSynthesizer,
  FileRunRecorder,
  NoopRunRecorder,
  OpenCodeHeadlessCliAdapter,
  resolvePanelComposition,
  runPanel,
  type PanelResult,
  type PanelRequest,
  type ProvenancePolicy,
  type ReasoningPreference,
  type RunRecorder,
  type SharedContext,
  type WorkerBudget,
  type WorkerRequest,
} from "../lib/protocol";

export interface CliOptions {
  parentModel?: string;
  models?: string[];
  panelists: number;
  panelistsExplicit: boolean;
  context?: string;
  contextFiles: string[];
  reasoning?: ReasoningPreference;
  maxTurns?: number;
  record: boolean;
  json: boolean;
  synthesizer: string;
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
    if (
      options.synthesizer !== "parent-agent" &&
      options.synthesizer !== "deterministic"
    ) {
      throw new UsageError(
        `Synthesizer strategy "${options.synthesizer}" not implemented yet.`,
      );
    }

    const prepared = await preparePanelRequest(options, { cwd: process.cwd() });
    const request = prepared.request;

    const recorder: RunRecorder = options.record
      ? new FileRunRecorder({
          workspaceRoot: process.cwd(),
          panelRunId: request.panelRunId,
        })
      : new NoopRunRecorder();
    const registry = new AdapterRegistry()
      .register("opencode", new OpenCodeHeadlessCliAdapter())
      .register("claude-code", new ClaudeCodeHeadlessCliAdapter());

    const result = await runPanel(request, {
      runner: registry,
      harnessSelector: registry,
      workerRequests: prepared.workerRequests,
      synthesizer: new DeterministicSynthesizer(),
      recorder,
    });
    if (prepared.warnings.length > 0) {
      result.warnings = [...prepared.warnings, ...(result.warnings ?? [])];
    }

    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(
        renderMarkdownReport(result, {
          recordingStatus: recorder.status,
          synthesizer: options.synthesizer,
        }),
      );
    }
    return result.status === "failed" ? 1 : 0;
  } catch (error) {
    if (error instanceof HelpRequested) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    const message = error instanceof Error ? error.message : String(error);
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
    synthesizer: { strategy: options.synthesizer },
    reasoning: options.reasoning,
    workerEnvironment: {
      workspaceRoot: cwd,
      workingDirectory: cwd,
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
    contextManifest,
  }));

  return {
    request,
    workerRequests: manifestedWorkerRequests,
    warnings: [...composition.warnings, ...contextResult.warnings],
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
    record: false,
    json: false,
    synthesizer: "parent-agent",
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
      case "--synthesizer":
        options.synthesizer = takeValue();
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

function renderMarkdownReport(
  result: PanelResult,
  options: { recordingStatus: string; synthesizer: string },
): string {
  const isParentAgent = options.synthesizer === "parent-agent";
  const warnings = result.warnings ?? [];
  const errors = result.errors ?? [];
  const lines = [
    "# Fusion Panel Report",
    "",
    `- Run status: ${result.status}`,
    `- Compliance tier: ${result.complianceSummary.tier}`,
    `- Synthesizer option: ${options.synthesizer}`,
  ];
  if (isParentAgent) {
    lines.push(
      "- Final answer: unset; the parent agent must author synthesis and final answer from this report.",
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

  const synthesisLabel = isParentAgent
    ? "## Reference Deterministic Synthesis (Audit Reference)"
    : "## Deterministic Synthesis";
  lines.push(
    synthesisLabel,
    "",
    `Strategy: deterministic${isParentAgent ? "; audit reference only" : ""}.`,
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
    "  --effort <level>          Worker reasoning effort: low, medium, high, or xhigh.",
    "  --reasoning-max-tokens <n>",
    "                            Worker reasoning token budget.",
    "  --max-turns <n>           Per-worker turn budget where supported.",
    "  --record                  Write .fusion-runs/<panelRunId>/ artifacts.",
    "  --json                    Print complete PanelResult JSON.",
    "  --synthesizer <strategy>  parent-agent or deterministic.",
    "  --timeout-ms <n>          Per-worker timeout.",
  ].join("\n");
}

if (import.meta.main) {
  process.exitCode = await main();
}
