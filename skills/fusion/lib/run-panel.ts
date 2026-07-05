import { evaluateCompliance } from "./compliance";
import type {
  HarnessDescriptor,
  HarnessPreference,
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
        const message = error instanceof Error ? error.message : String(error);
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

  const complianceEventIndex = events.length;
  await emit("compliance.evaluated");
  const finalComplianceSummary = evaluateCompliance({
    panelRequest: request,
    workerRequests,
    workerResults,
    events,
    synthesisPresent: synthesisResult.synthesis.length > 0,
  });
  events[complianceEventIndex].data = { tier: finalComplianceSummary.tier };
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
    synthesis: synthesisResult.synthesis,
    finalAnswer: synthesisResult.finalAnswer,
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
  });
  try {
    const synthesisResult = await options.synthesizer.synthesize({
      panelRequest: request,
      workerRequests,
      workerResults,
      events: [...events],
    });
    if (request.synthesizer?.strategy === "parent-agent") {
      // Parent-agent strategy: synthesis stays as an audit reference, but the
      // final answer must be authored by the parent agent, not the synthesizer.
      return { ...synthesisResult, finalAnswer: undefined };
    }
    return synthesisResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { synthesis: "", errors: [message] };
  } finally {
    await emit("synthesis.completed", {
      workerResultIds: workerResults.map((result) => result.workerId),
    });
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

async function recordSafely(
  warnings: string[],
  record: () => Promise<void> | void | undefined,
): Promise<void> {
  try {
    await record();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Run recorder failed: ${message}`);
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
      observedToolPolicy: workerRequest.toolsPolicy,
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

function normalizeHarnessDescriptor(
  harness: HarnessPreference | undefined,
): HarnessDescriptor | undefined {
  if (harness?.kind === undefined || harness.invocation === undefined) {
    return undefined;
  }
  return {
    kind: harness.kind,
    invocation: harness.invocation,
    version: harness.version,
  };
}

function createEventIdFactory(): () => string {
  let nextId = 1;
  return () => `event-${nextId++}`;
}
