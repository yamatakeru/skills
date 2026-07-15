import { expect } from "bun:test";
import {
  buildWorkerRequests,
  createContextManifest,
  defaultPolicies,
  deriveContainment,
  normalizeHarnessDescriptor,
  renderWorkerPrompt,
  type CommandExecution,
  type CommandExecutor,
  type PanelRequest,
  type SessionMode,
  type WorkerRequest,
  type WorkerResult,
  type WorkerRunner,
} from "../lib/protocol";

export function panelRequest(
  options: {
    panelRunId?: string;
    synthesisAllowPartial?: boolean;
    synthesizer?: PanelRequest["synthesizer"];
    workerCount?: number;
  } = {},
): PanelRequest {
  const sharedContext = {
    text: "shared",
    references: [{ label: "env", uri: "token=do-not-write" }],
  };
  const prompt = "Answer independently.";
  return {
    panelRunId: options.panelRunId ?? "panel-run-1",
    prompt,
    sharedContext,
    contextManifest: createContextManifest({
      renderedPrompt: renderWorkerPrompt({
        task: prompt,
        outputContract: defaultPolicies.output,
        sharedContext,
      }),
      userTask: prompt,
      sharedContext,
    }),
    panelSpec: { workerCount: options.workerCount ?? 2 },
    harnessSelectionPolicy: { availableHarnesses: ["opencode"] },
    synthesisContract: {
      requiredFindings: ["consensus", "contradictions", "blind-spots"],
      format: "markdown",
      allowPartial: options.synthesisAllowPartial ?? true,
      requireAttribution: true,
    },
    synthesizer: options.synthesizer,
    provenancePolicy: defaultPolicies.provenance,
  };
}

export function workerRequest(): WorkerRequest {
  const [request] = buildWorkerRequests(panelRequest());
  if (request === undefined) {
    throw new Error("Expected test worker request.");
  }
  return {
    ...request,
    modelPreference: { provider: "openai", model: "gpt-5.5" },
    environment: { workspaceRoot: "/workspace" },
  };
}

export function opencodeModelsExecutor(models: string[]): CommandExecutor {
  return async (execution: CommandExecution) => {
    expect(execution.command).toBe("opencode");
    expect(execution.args).toEqual(["models"]);
    return {
      exitCode: 0,
      stdout: `${models.join("\n")}\n`,
      stderr: "",
      durationMs: 1,
    };
  };
}

export function workerRequestFrom(
  request: WorkerRequest | undefined,
): WorkerRequest {
  if (request === undefined) {
    throw new Error("Expected test worker request.");
  }
  return request;
}

export function okRunner(
  options: { sessionMode?: SessionMode } = {},
): WorkerRunner {
  return {
    async runWorker(request: WorkerRequest): Promise<WorkerResult> {
      return okWorkerResult(request, options.sessionMode);
    },
  };
}

export function mixedRunner(): WorkerRunner {
  return {
    async runWorker(request: WorkerRequest): Promise<WorkerResult> {
      if (request.workerId === "worker-2") {
        throw new Error("boom");
      }
      return okWorkerResult(request);
    },
  };
}

export function okWorkerResult(
  request: WorkerRequest,
  sessionMode: SessionMode = "fresh",
): WorkerResult {
  return {
    panelRunId: request.panelRunId,
    workerId: request.workerId,
    status: "ok",
    output: `${request.workerId} output`,
    harnessUsed: normalizeHarnessDescriptor(request.harness),
    complianceEvidence: {
      adapterClaimsIndependentInvocation: true,
      adapterClaimsIsolatedContext: true,
      adapterClaimsBlindness: request.blindnessPolicy.noPeerOutputs,
      observedSessionMode: sessionMode,
      enforcement: { source: "harness-declared", permissionDenialCount: 0 },
      containment: deriveContainment(request.toolsPolicy),
    },
  };
}

export function okWorkerResultWithModel(
  workerId: string,
  modelUsed: string,
): WorkerResult {
  const request = workerRequest();
  return {
    ...okWorkerResult({ ...request, workerId }),
    modelUsed,
  };
}

export function judgeRunner(
  options: {
    judgeOutput?: string;
    judgeError?: Error;
    modelUsed?: string;
  } = {},
): WorkerRunner & { requests: WorkerRequest[] } {
  const requests: WorkerRequest[] = [];
  return {
    requests,
    async runWorker(request: WorkerRequest): Promise<WorkerResult> {
      requests.push(request);
      if (request.workerId === "judge") {
        if (options.judgeError !== undefined) {
          throw options.judgeError;
        }
        return {
          ...okWorkerResult(request),
          output: options.judgeOutput ?? judgeAnalysisJson(),
          modelUsed: options.modelUsed ?? "openai/gpt-5.5",
        };
      }
      return okWorkerResult(request);
    },
  };
}

export function judgeAnalysisJson(
  overrides: Partial<{
    consensus: unknown[];
    contradictions: unknown[];
    partial_coverage: unknown[];
    unique_insights: unknown[];
    blind_spots: unknown[];
  }> = {},
): string {
  return JSON.stringify({
    consensus: [
      {
        text: "Workers agree on the core answer.",
        attribution: [{ workerId: "worker-1" }],
        quotes: [{ workerId: "worker-1", quote: "worker-1 output" }],
      },
    ],
    contradictions: [
      {
        topic: "No material contradiction",
        stances: { "worker-1": "aligned", "worker-2": "aligned" },
      },
    ],
    partial_coverage: ["worker-2 covered a secondary detail"],
    unique_insights: [],
    blind_spots: ["No worker verified external references"],
    ...overrides,
  });
}

export async function withFusionPanelDepth<T>(
  depth: string | undefined,
  action: () => Promise<T>,
): Promise<T> {
  const original = process.env.FUSION_PANEL_DEPTH;
  if (depth === undefined) {
    delete process.env.FUSION_PANEL_DEPTH;
  } else {
    process.env.FUSION_PANEL_DEPTH = depth;
  }
  try {
    return await action();
  } finally {
    if (original === undefined) {
      delete process.env.FUSION_PANEL_DEPTH;
    } else {
      process.env.FUSION_PANEL_DEPTH = original;
    }
  }
}
