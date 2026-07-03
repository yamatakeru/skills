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

export async function runPanel(
  request: PanelRequest,
  options: PanelRunOptions,
): Promise<PanelResult> {
  validatePanelSpec(request.panelSpec);

  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? createEventIdFactory();
  const events: ProvenanceEvent[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const emit = (
    type: ProvenanceEventType,
    data?: Record<string, unknown>,
    workerId?: string,
  ) => {
    events.push({
      eventId: idFactory(),
      panelRunId: request.panelRunId,
      workerId,
      type,
      timestamp: now().toISOString(),
      data,
    });
  };

  emit("panel.started", { workerCount: request.panelSpec.workerCount });
  emit("context.manifested", { contextManifest: request.contextManifest });

  const workerRequests = buildWorkerRequests(
    request,
    options.defaults,
    options.harnessSelector ?? defaultHarnessSelector,
  );

  for (const workerRequest of workerRequests) {
    emit(
      "harness.selected",
      { harness: workerRequest.harness },
      workerRequest.workerId,
    );
    emit(
      "worker.invocation.requested",
      { request: redactWorkerRequest(workerRequest) },
      workerRequest.workerId,
    );
  }

  const workerResults = await Promise.all(
    workerRequests.map(async (workerRequest): Promise<WorkerResult> => {
      emit("worker.invocation.started", undefined, workerRequest.workerId);
      try {
        const result = await options.runner.runWorker(workerRequest);
        emit(
          "worker.invocation.completed",
          { status: result.status },
          workerRequest.workerId,
        );
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit(
          "worker.invocation.failed",
          { error: message },
          workerRequest.workerId,
        );
        return failedWorkerResult(workerRequest, message);
      }
    }),
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

  const complianceEventIndex = events.length;
  emit("compliance.evaluated");
  const finalComplianceSummary = evaluateCompliance({
    panelRequest: request,
    workerRequests,
    workerResults,
    events,
    synthesisPresent: synthesisResult.synthesis.length > 0,
  });
  events[complianceEventIndex].data = { tier: finalComplianceSummary.tier };

  return {
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
    warnings: [...warnings, ...(finalComplianceSummary.notes ?? [])],
    errors: errors.length === 0 ? undefined : errors,
  };
}

async function runSynthesisIfAllowed(
  request: PanelRequest,
  options: PanelRunOptions,
  workerRequests: WorkerRequest[],
  workerResults: WorkerResult[],
  events: ProvenanceEvent[],
  emit: (
    type: ProvenanceEventType,
    data?: Record<string, unknown>,
    workerId?: string,
  ) => void,
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
      errors: [
        okWorkerResults.length === 0
          ? "Synthesis skipped because no workers returned ok."
          : "Synthesis skipped because partial synthesis is disabled and at least one worker failed.",
      ],
    };
  }

  emit("synthesis.started", {
    workerResultIds: workerResults.map((result) => result.workerId),
  });
  try {
    return await options.synthesizer.synthesize({
      panelRequest: request,
      workerRequests,
      workerResults,
      events,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { synthesis: "", errors: [message] };
  } finally {
    emit("synthesis.completed", {
      workerResultIds: workerResults.map((result) => result.workerId),
    });
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
