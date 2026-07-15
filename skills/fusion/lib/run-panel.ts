import { evaluateCompliance } from "./compliance";
import { deriveContainment } from "./containment";
import { errorMessage } from "./errors";
import { normalizeHarnessDescriptor } from "./harness";
import { describeJudgeInvocation } from "./judge-synthesizer";
import { compareWorkspace, snapshotWorkspace } from "./watchdog";
import type {
  PanelRequest,
  PanelResult,
  PanelRunOptions,
  PanelStatus,
  ProvenanceEvent,
  ProvenanceEventType,
  SynthesisResult,
  WorkerRequest,
  WorkerResult,
} from "./types";
import { validatePanelSpec } from "./validation";
import { buildWorkerRequests, defaultHarnessSelector } from "./worker-requests";

type EmitEvent = (
  type: ProvenanceEventType,
  data?: Record<string, unknown>,
  workerId?: string,
) => Promise<void>;

export async function runPanel(
  request: PanelRequest,
  options: PanelRunOptions,
): Promise<PanelResult> {
  validatePanelSpec(request.panelSpec);

  const workspaceRoot =
    request.workerEnvironment?.workspaceRoot ??
    request.workerEnvironment?.workingDirectory ??
    process.cwd();
  const workspaceSnapshot = await snapshotWorkspace(workspaceRoot);
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? createEventIdFactory();
  const events: ProvenanceEvent[] = [];
  const warnings: string[] = [];
  const recorderWarnings: string[] = [];
  const errors: string[] = [];
  const recorder = options.recorder;
  const emit: EmitEvent = async (type, data, workerId) => {
    const event = {
      eventId: idFactory(),
      panelRunId: request.panelRunId,
      workerId,
      type,
      timestamp: now().toISOString(),
      data,
    };
    events.push(event);
    await recordSafely(recorderWarnings, () => recorder?.recordEvent?.(event));
  };

  await recordSafely(recorderWarnings, () =>
    recorder?.recordRequest?.(request),
  );
  await recordSafely(recorderWarnings, () =>
    recorder?.recordManifest?.(request.contextManifest),
  );
  await emit("panel.started", { workerCount: request.panelSpec.workerCount });
  await emit("context.manifested", {
    contextManifest: request.contextManifest,
  });

  const workerRequests =
    options.workerRequests ??
    buildWorkerRequests(
      request,
      options.defaults,
      options.harnessSelector ?? defaultHarnessSelector,
    );

  for (const workerRequest of workerRequests) {
    await emit(
      "harness.selected",
      { harness: workerRequest.harness },
      workerRequest.workerId,
    );
    await emit(
      "worker.invocation.requested",
      { request: redactWorkerRequest(workerRequest) },
      workerRequest.workerId,
    );
  }
  await recordSafely(recorderWarnings, () =>
    recorder?.recordWorkerRequests?.(workerRequests),
  );

  const workerResults = await Promise.all(
    workerRequests.map(async (workerRequest): Promise<WorkerResult> => {
      await emit(
        "worker.invocation.started",
        undefined,
        workerRequest.workerId,
      );
      try {
        const result = await options.runner.runWorker(workerRequest);
        await emit(
          "worker.invocation.completed",
          { status: result.status },
          workerRequest.workerId,
        );
        return result;
      } catch (error) {
        const message = errorMessage(error);
        await emit(
          "worker.invocation.failed",
          { error: message },
          workerRequest.workerId,
        );
        return failedWorkerResult(workerRequest, message);
      }
    }),
  );
  await recordSafely(recorderWarnings, () =>
    recorder?.recordWorkerResults?.(workerResults),
  );

  const synthesisResult = await runSynthesisIfAllowed(
    request,
    options,
    workerRequests,
    workerResults,
    events,
    emit,
  );
  warnings.push(...(synthesisResult.warnings ?? []));
  errors.push(...(synthesisResult.errors ?? []));
  await recordSafely(recorderWarnings, () =>
    recorder?.recordSynthesis?.(synthesisResult),
  );

  const workspaceWatchdog = await compareWorkspace(workspaceSnapshot);
  await emit("workspace.watchdog.completed", {
    verdict: workspaceWatchdog.verdict,
    workspaceRoot: workspaceWatchdog.workspaceRoot,
    changedPaths: workspaceWatchdog.changedPaths,
    refDiffs: workspaceWatchdog.refDiffs,
    note: workspaceWatchdog.note,
    limitations: workspaceWatchdog.limitations,
  });

  // The compliance evaluation requires the compliance.evaluated event to be
  // present, but the event's recorded payload must carry the resulting tier:
  // append the event first and write it to the recorder only after the tier
  // is known, so the events.jsonl line is complete.
  const complianceEvent = {
    eventId: idFactory(),
    panelRunId: request.panelRunId,
    workerId: undefined,
    type: "compliance.evaluated" as const,
    timestamp: now().toISOString(),
    data: undefined as Record<string, unknown> | undefined,
  };
  events.push(complianceEvent);
  const finalComplianceSummary = evaluateCompliance({
    panelRequest: request,
    workerRequests,
    workerResults,
    events,
    synthesisResult,
    workspaceWatchdog,
  });
  complianceEvent.data = { tier: finalComplianceSummary.tier };
  await recordSafely(recorderWarnings, () =>
    recorder?.recordEvent?.(complianceEvent),
  );
  await recordSafely(recorderWarnings, () =>
    recorder?.recordCompliance?.(finalComplianceSummary),
  );

  const result: PanelResult = {
    panelRunId: request.panelRunId,
    status: determinePanelStatus(
      workerResults,
      request.synthesisContract.allowPartial,
      errors,
    ),
    workerResults,
    analysis: synthesisResult.analysis,
    synthesis: synthesisResult.synthesis,
    finalAnswer: synthesisResult.finalAnswer,
    strategy: synthesisResult.strategy,
    fallbackReason: synthesisResult.fallbackReason,
    complianceSummary: finalComplianceSummary,
    events: request.provenancePolicy?.eventLog === false ? undefined : events,
    warnings: buildWarnings(
      warnings,
      finalComplianceSummary.notes,
      recorderWarnings,
    ),
    errors: errors.length === 0 ? undefined : errors,
  };
  await recordSafely(recorderWarnings, () => recorder?.recordResult?.(result));
  if (recorderWarnings.length > 0) {
    result.warnings = buildWarnings(
      warnings,
      finalComplianceSummary.notes,
      recorderWarnings,
    );
  }
  return result;
}

async function runSynthesisIfAllowed(
  request: PanelRequest,
  options: PanelRunOptions,
  workerRequests: WorkerRequest[],
  workerResults: WorkerResult[],
  events: ProvenanceEvent[],
  emit: EmitEvent,
): Promise<SynthesisResult> {
  const okWorkerResults = workerResults.filter(
    (result) => result.status === "ok",
  );
  const canSynthesize =
    okWorkerResults.length === workerResults.length ||
    (request.synthesisContract.allowPartial && okWorkerResults.length > 0);

  if (!canSynthesize) {
    return {
      synthesis: "",
      errors: [skippedSynthesisReason(okWorkerResults.length)],
    };
  }

  await emit("synthesis.started", {
    workerResultIds: workerResults.map((result) => result.workerId),
    strategy: request.synthesizer?.strategy,
    modelPreference: request.synthesizer?.model,
  });
  let synthesisResult: SynthesisResult | undefined;
  let thrownMessage: string | undefined;
  try {
    synthesisResult = await options.synthesizer.synthesize({
      panelRequest: request,
      workerRequests,
      workerResults,
      events: [...events],
    });
    if (request.synthesizer?.strategy === "parent-agent") {
      // Parent-agent strategy: synthesis stays as an audit reference, but the
      // final answer must be authored by the parent agent, not the synthesizer.
      return {
        ...synthesisResult,
        strategy: "parent-agent",
        finalAnswer: undefined,
      };
    }
    return synthesisResult;
  } catch (error) {
    const message = errorMessage(error);
    thrownMessage = message;
    return { synthesis: "", errors: [message] };
  } finally {
    await emit(
      "synthesis.completed",
      synthesisCompletedData(workerResults, synthesisResult, thrownMessage),
    );
  }
}

function skippedSynthesisReason(okWorkerCount: number): string {
  if (okWorkerCount === 0) {
    return "Synthesis skipped because no workers returned ok.";
  }

  return "Synthesis skipped because partial synthesis is disabled and at least one worker failed.";
}

function buildWarnings(
  warnings: string[],
  complianceNotes: string[] | undefined,
  recorderWarnings: string[],
): string[] {
  return [...warnings, ...(complianceNotes ?? []), ...recorderWarnings];
}

function synthesisCompletedData(
  workerResults: WorkerResult[],
  synthesisResult: SynthesisResult | undefined,
  error: string | undefined,
): Record<string, unknown> {
  const judge = describeJudgeInvocation(synthesisResult);
  const judgeRequest = synthesisResult?.judgeRequest;
  return {
    workerResultIds: workerResults.map((result) => result.workerId),
    strategy: synthesisResult?.strategy,
    analysisPresent: synthesisResult?.analysis !== undefined,
    fallbackReason: synthesisResult?.fallbackReason,
    error,
    judge:
      judge.workerId && judgeRequest
        ? {
            ...judge,
            modelPreference: judgeRequest.modelPreference,
            usage: synthesisResult?.judgeResult?.usage,
          }
        : undefined,
  };
}

async function recordSafely(
  warnings: string[],
  record: () => Promise<void> | void | undefined,
): Promise<void> {
  try {
    await record();
  } catch (error) {
    warnings.push(`Run recorder failed: ${errorMessage(error)}`);
  }
}

function failedWorkerResult(
  workerRequest: WorkerRequest,
  message: string,
): WorkerResult {
  return {
    panelRunId: workerRequest.panelRunId,
    workerId: workerRequest.workerId,
    status: "error",
    output: "",
    harnessUsed: normalizeHarnessDescriptor(workerRequest.harness),
    complianceEvidence: {
      observedSessionMode: workerRequest.session.mode,
      containment: deriveContainment(workerRequest.toolsPolicy),
      notes: ["Worker runner threw before returning a result."],
    },
    errors: [message],
  };
}

function determinePanelStatus(
  workerResults: WorkerResult[],
  allowPartial: boolean,
  errors: string[],
): PanelStatus {
  const okCount = workerResults.filter(
    (result) => result.status === "ok",
  ).length;
  if (
    workerResults.length > 0 &&
    okCount === workerResults.length &&
    errors.length === 0
  ) {
    return "ok";
  }
  if (okCount > 0 && allowPartial) {
    return "partial";
  }
  return "failed";
}

function redactWorkerRequest(request: WorkerRequest): Record<string, unknown> {
  return {
    workerId: request.workerId,
    modelPreference: request.modelPreference,
    harness: request.harness,
    session: request.session,
    isolationPolicy: request.isolationPolicy,
    blindnessPolicy: request.blindnessPolicy,
    workerPolicy: request.workerPolicy,
    toolsPolicy: request.toolsPolicy,
    outputContract: request.outputContract,
  };
}

function createEventIdFactory(): () => string {
  let nextId = 1;
  return () => `event-${nextId++}`;
}
