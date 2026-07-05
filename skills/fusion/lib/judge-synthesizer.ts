import { mergeDefaultPolicies } from "./defaults";
import { errorMessage } from "./errors";
import { normalizeHarnessDescriptor } from "./harness";
import {
  parseJudgeAnalysisOutput,
  renderJudgeAnalysisMarkdown,
} from "./judge-analysis";
import { createContextManifest } from "./manifest";
import { modelPreferenceToModel } from "./headless-cli-adapters";
import {
  buildWorkerRequestBase,
  defaultHarnessSelector,
} from "./worker-requests";
import type {
  DefaultPolicies,
  HarnessDescriptor,
  HarnessSelector,
  ModelPreference,
  PanelRequest,
  Synthesizer,
  SynthesisInput,
  SynthesisResult,
  ToolsPolicy,
  WorkerRequest,
  WorkerResult,
  WorkerRunner,
} from "./types";
import { isHarnessSynthesizerStrategy } from "./types";
import { DeterministicSynthesizer } from "./deterministic-synthesizer";

export interface HarnessBackedJudgeSynthesizerOptions {
  runner: WorkerRunner;
  harnessSelector?: HarnessSelector;
  defaults?: Partial<DefaultPolicies>;
  fallbackSynthesizer?: Synthesizer;
}

export class HarnessBackedJudgeSynthesizer implements Synthesizer {
  private readonly fallbackSynthesizer: Synthesizer;

  constructor(private readonly options: HarnessBackedJudgeSynthesizerOptions) {
    this.fallbackSynthesizer =
      options.fallbackSynthesizer ?? new DeterministicSynthesizer();
  }

  async synthesize(input: SynthesisInput): Promise<SynthesisResult> {
    const fallback = await this.fallbackSynthesizer.synthesize(input);
    const judgeRequest = buildJudgeRequest(input, {
      defaults: this.options.defaults,
      harnessSelector: this.options.harnessSelector,
    });
    let judgeResult: WorkerResult | undefined;

    try {
      judgeResult = await this.options.runner.runWorker(judgeRequest);
      if (judgeResult.status !== "ok") {
        return this.fallback(input, fallback, judgeRequest, judgeResult);
      }

      const parsed = parseJudgeAnalysisOutput(
        judgeResult.output,
        input.workerResults,
      );
      return {
        strategy: judgeRequest.harness?.kind,
        analysis: parsed.analysis,
        synthesis: renderJudgeAnalysisMarkdown(parsed.analysis),
        finalAnswer: undefined,
        judgeRequest,
        judgeResult,
        referenceSynthesis: fallback.synthesis,
        warnings: parsed.warnings.length === 0 ? undefined : parsed.warnings,
      };
    } catch (error) {
      return this.fallback(input, fallback, judgeRequest, judgeResult, error);
    }
  }

  private fallback(
    input: SynthesisInput,
    fallback: SynthesisResult,
    judgeRequest: WorkerRequest,
    judgeResult?: WorkerResult,
    error?: unknown,
  ): SynthesisResult {
    const reason =
      error === undefined
        ? judgeResultReason(judgeResult)
        : errorMessage(error);

    return {
      ...fallback,
      strategy: "parent-agent",
      finalAnswer: undefined,
      judgeRequest,
      judgeResult,
      referenceSynthesis: fallback.synthesis,
      fallbackReason: reason,
      warnings: [
        `Judge synthesis failed; falling back to parent-agent synthesis from raw worker outputs: ${reason}`,
        ...(fallback.warnings ?? []),
      ],
      errors: undefined,
    };
  }
}

export function buildJudgeRequest(
  input: SynthesisInput,
  options: {
    defaults?: Partial<DefaultPolicies>;
    harnessSelector?: HarnessSelector;
  } = {},
): WorkerRequest {
  const request = input.panelRequest;
  const policies = mergeDefaultPolicies(options.defaults ?? {});
  const modelPreference =
    request.synthesizer?.model ?? request.panelSpec.parentModel;
  const harness = selectJudgeHarness(
    request,
    modelPreference,
    options.harnessSelector ?? defaultHarnessSelector,
  );
  const prompt = renderJudgePrompt({
    task: request.prompt,
    workerResults: input.workerResults,
  });

  return {
    ...buildWorkerRequestBase({
      request,
      policies,
      workerId: "judge",
      prompt,
      modelPreference,
      harness,
      contextManifest: createContextManifest({
        renderedPrompt: prompt,
        userTask: request.prompt,
        sharedContext: request.sharedContext,
      }),
    }),
    blindnessPolicy: {
      noPeerOutputs: false,
      noDraftSynthesis: true,
      noPanelConclusions: true,
    },
    toolsPolicy: noToolsPolicy(policies.tools),
    outputContract: {
      format: "json",
      schemaName: "JudgeAnalysis",
      forbidChainOfThought: true,
    },
  };
}

export function renderJudgePrompt(input: {
  task: string;
  workerResults: WorkerResult[];
}): string {
  return [
    "You are the Fusion judge. Compare the worker outputs; do not merge them, resolve them, or write the final answer.",
    "Return only one JSON object. Do not wrap it in prose.",
    "",
    "Required top-level keys, and no others:",
    "- consensus: array of strings, or objects with text plus optional attribution and quotes.",
    "- contradictions: array of objects with topic and stances.",
    "- partial_coverage: array of strings, or objects with text plus optional attribution and quotes.",
    "- unique_insights: array of strings, or objects with text plus optional attribution and quotes.",
    "- blind_spots: array of strings, or objects with text plus optional attribution and quotes.",
    "",
    "Use this exact JSON skeleton. The stance body text must be under the key \"stance\"; never invent keys such as \"stances_text\":",
    JSON.stringify(
      {
        consensus: [
          {
            text: "...",
            attribution: [{ workerId: "worker-1", modelUsed: "..." }],
            quotes: [{ workerId: "worker-1", quote: "..." }],
          },
        ],
        contradictions: [
          {
            topic: "...",
            stances: [
              {
                stance: "...",
                workerId: "worker-1",
                modelUsed: "...",
                quotes: [{ workerId: "worker-1", quote: "..." }],
              },
            ],
          },
        ],
        partial_coverage: [
          {
            text: "...",
            attribution: [{ workerId: "worker-1", modelUsed: "..." }],
            quotes: [{ workerId: "worker-1", quote: "..." }],
          },
        ],
        unique_insights: [
          {
            text: "...",
            attribution: [{ workerId: "worker-1", modelUsed: "..." }],
            quotes: [{ workerId: "worker-1", quote: "..." }],
          },
        ],
        blind_spots: [
          {
            text: "...",
            attribution: [{ workerId: "worker-1", modelUsed: "..." }],
            quotes: [{ workerId: "worker-1", quote: "..." }],
          },
        ],
      },
      null,
      2,
    ),
    "",
    "Optional extensions for any finding object:",
    '- attribution: [{"workerId":"worker-1","modelUsed":"optional model id"}]',
    '- quotes: [{"workerId":"worker-1","quote":"verbatim substring from that worker output"}]',
    "",
    'For contradiction stances, use either an object mapping worker/model labels to stance text, or an array of strings/objects. Stance objects must put the stance text in "stance" and may include workerId, modelUsed, attribution, and quotes.',
    "Do not include a resolution, verdict, recommendation, winner, or final answer.",
    "",
    "Task:",
    input.task,
    "",
    "Worker outputs:",
    ...input.workerResults.flatMap((result) => [
      "",
      `## ${result.workerId}`,
      `Status: ${result.status}`,
      `Model: ${result.modelUsed ?? "unknown"}`,
      `Harness: ${result.harnessUsed?.kind ?? "unknown"}`,
      "",
      result.output.trim() || "[empty output]",
    ]),
  ].join("\n");
}

function selectJudgeHarness(
  request: PanelRequest,
  modelPreference: ModelPreference | undefined,
  harnessSelector: HarnessSelector,
): HarnessDescriptor {
  const strategy = request.synthesizer?.strategy;
  if (isHarnessSynthesizerStrategy(strategy)) {
    return { kind: strategy, invocation: "headless" };
  }

  return harnessSelector.selectHarness({
    workerId: "judge",
    modelPreference,
    policy: request.harnessSelectionPolicy,
  });
}

function noToolsPolicy(panelTools: ToolsPolicy): ToolsPolicy {
  return {
    mode: "none",
    allow: [],
    deny: panelTools.allow,
    headlessAskBehavior: "deny",
    parity: "strict-same-required",
  };
}

export function describeJudgeInvocation(
  synthesisResult: SynthesisResult | undefined,
): {
  workerId?: string;
  status?: WorkerResult["status"];
  modelUsed?: string;
  harnessUsed?: HarnessDescriptor;
} {
  const judgeRequest = synthesisResult?.judgeRequest;
  if (judgeRequest === undefined) {
    return {};
  }
  const judgeResult = synthesisResult?.judgeResult;
  return {
    workerId: judgeRequest.workerId,
    status: judgeResult?.status,
    modelUsed:
      judgeResult?.modelUsed ??
      modelPreferenceToModel(judgeRequest.modelPreference),
    harnessUsed:
      judgeResult?.harnessUsed ??
      normalizeHarnessDescriptor(judgeRequest.harness),
  };
}

function judgeResultReason(judgeResult: WorkerResult | undefined): string {
  if (judgeResult === undefined) {
    return "judge runner did not return a result";
  }
  const detail = judgeResult.errors?.join("; ");
  return detail === undefined || detail.length === 0
    ? `judge returned status ${judgeResult.status}`
    : `judge returned status ${judgeResult.status}: ${detail}`;
}
