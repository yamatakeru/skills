import { stableStringify } from "./manifest";
import type {
  ComplianceSummary,
  ComplianceTier,
  PanelRequest,
  ProvenanceEvent,
  ProvenanceEventType,
  SessionMode,
  ToolsPolicy,
  WorkerCompliance,
  WorkerComplianceEvidence,
  WorkerRequest,
  WorkerResult,
} from "./types";

export function evaluateCompliance(input: {
  panelRequest: PanelRequest;
  workerRequests: WorkerRequest[];
  workerResults: WorkerResult[];
  events: ProvenanceEvent[];
  synthesisPresent: boolean;
}): ComplianceSummary {
  const missingRequiredEvents = findMissingRequiredEvents(input);
  const failedWorkers = input.workerResults
    .filter((result) => result.status !== "ok")
    .map((result) => result.workerId);
  const workerCompliance = input.workerRequests.map((workerRequest) => {
    const result = input.workerResults.find(
      (candidate) => candidate.workerId === workerRequest.workerId,
    );
    return {
      workerId: workerRequest.workerId,
      compliance: evaluateWorkerCompliance(
        workerRequest,
        result,
        missingRequiredEvents,
      ),
    };
  });
  const degradedWorkers = workerCompliance
    .filter(
      ({ compliance }) =>
        compliance.tier === "degraded" || compliance.tier === "non-compliant",
    )
    .map(({ workerId }) => workerId);
  const workerTiers = workerCompliance.map(({ compliance }) => compliance.tier);
  const hasTooFewWorkers = input.workerRequests.length < 2;
  const tier = determineComplianceTier({
    hasNonCompliantWorker: workerTiers.includes("non-compliant"),
    hasMissingRequiredEvents: missingRequiredEvents.length > 0,
    hasFailedWorkers: failedWorkers.length > 0,
    hasDegradedWorker: workerTiers.includes("degraded"),
    hasReusedIsolatedSession: workerTiers.includes(
      "full-reused-isolated-session",
    ),
    hasTooFewWorkers,
  });
  const notes: string[] = [];

  if (hasTooFewWorkers) {
    notes.push(
      "Full Fusion compliance requires at least two independent workers.",
    );
  }
  if (
    !hasEvent(input.events, "synthesis.started") &&
    hasEvent(input.events, "synthesis.completed")
  ) {
    notes.push(
      "Missing synthesis.started is warning-only when synthesis.completed records inputs.",
    );
  }

  return {
    tier,
    workerCompliance,
    degradedWorkers: degradedWorkers.length === 0 ? undefined : degradedWorkers,
    failedWorkers: failedWorkers.length === 0 ? undefined : failedWorkers,
    missingRequiredEvents:
      missingRequiredEvents.length === 0 ? undefined : missingRequiredEvents,
    notes: notes.length === 0 ? undefined : notes,
  };
}

function evaluateWorkerCompliance(
  workerRequest: WorkerRequest,
  result: WorkerResult | undefined,
  missingRequiredEvents: string[],
): WorkerCompliance {
  const evidence = result?.complianceEvidence;
  const sessionMode =
    evidence?.observedSessionMode ?? workerRequest.session.mode;
  const independentInvocation =
    evidence?.adapterClaimsIndependentInvocation === true;
  const isolatedContext = evidence?.adapterClaimsIsolatedContext === true;
  const blind = evidence?.adapterClaimsBlindness === true;
  const toolPolicyMatchedPanelDefault = toolsPolicyEquals(
    evidence?.observedToolPolicy,
    workerRequest.toolsPolicy,
  );
  const workerMissingRequiredEvents = missingRequiredEvents.some((event) =>
    event.includes(workerRequest.workerId),
  );
  const degradedReasons = [
    result === undefined ? "worker result missing" : undefined,
    result && result.status !== "ok"
      ? `worker status is ${result.status}`
      : undefined,
    !independentInvocation ? "independent invocation not proven" : undefined,
    !isolatedContext ? "isolated context not proven" : undefined,
    !blind ? "blindness not proven" : undefined,
    workerMissingRequiredEvents
      ? "required worker lifecycle events missing"
      : undefined,
    !toolPolicyMatchedPanelDefault
      ? "observed tool policy does not match request"
      : undefined,
    resumeSessionDegradedReason(workerRequest, evidence),
    recursiveDelegationDegradedReason(workerRequest),
  ].filter((reason): reason is string => reason !== undefined);

  return {
    tier:
      degradedReasons.length === 0
        ? sessionComplianceTier(sessionMode)
        : "degraded",
    independentInvocation,
    blind,
    noPeerOutputs: blind && workerRequest.blindnessPolicy.noPeerOutputs,
    noDraftSynthesis: blind && workerRequest.blindnessPolicy.noDraftSynthesis,
    noPanelConclusions:
      blind && workerRequest.blindnessPolicy.noPanelConclusions,
    isolatedContext,
    sessionMode,
    toolPolicyMatchedPanelDefault,
    degradedReason:
      degradedReasons.length === 0 ? undefined : degradedReasons.join("; "),
  };
}

function sessionComplianceTier(sessionMode: SessionMode): ComplianceTier {
  return sessionMode === "resume" ? "full-reused-isolated-session" : "full";
}

function determineComplianceTier(input: {
  hasNonCompliantWorker: boolean;
  hasMissingRequiredEvents: boolean;
  hasFailedWorkers: boolean;
  hasDegradedWorker: boolean;
  hasReusedIsolatedSession: boolean;
  hasTooFewWorkers: boolean;
}): ComplianceTier {
  if (input.hasNonCompliantWorker) {
    return "non-compliant";
  }
  if (
    input.hasMissingRequiredEvents ||
    input.hasFailedWorkers ||
    input.hasDegradedWorker ||
    input.hasTooFewWorkers
  ) {
    return "degraded";
  }
  return input.hasReusedIsolatedSession
    ? "full-reused-isolated-session"
    : "full";
}

function findMissingRequiredEvents(input: {
  workerRequests: WorkerRequest[];
  events: ProvenanceEvent[];
  synthesisPresent: boolean;
}): string[] {
  const missing: string[] = [];
  for (const eventType of ["panel.started", "context.manifested"] as const) {
    if (!hasEvent(input.events, eventType)) {
      missing.push(eventType);
    }
  }
  for (const request of input.workerRequests) {
    for (const eventType of [
      "harness.selected",
      "worker.invocation.requested",
      "worker.invocation.started",
    ] as const) {
      if (!hasEvent(input.events, eventType, request.workerId)) {
        missing.push(`${eventType}:${request.workerId}`);
      }
    }
    if (
      !hasEvent(
        input.events,
        "worker.invocation.completed",
        request.workerId,
      ) &&
      !hasEvent(input.events, "worker.invocation.failed", request.workerId)
    ) {
      missing.push(
        `worker.invocation.completed|worker.invocation.failed:${request.workerId}`,
      );
    }
  }
  if (
    input.synthesisPresent &&
    !hasEvent(input.events, "synthesis.completed")
  ) {
    missing.push("synthesis.completed");
  }
  if (!hasEvent(input.events, "compliance.evaluated")) {
    missing.push("compliance.evaluated");
  }
  return missing;
}

function hasEvent(
  events: ProvenanceEvent[],
  type: ProvenanceEventType,
  workerId?: string,
): boolean {
  return events.some(
    (event) =>
      event.type === type &&
      (workerId === undefined || event.workerId === workerId),
  );
}

function resumeSessionDegradedReason(
  workerRequest: WorkerRequest,
  evidence: WorkerComplianceEvidence | undefined,
): string | undefined {
  const sessionMode =
    evidence?.observedSessionMode ?? workerRequest.session.mode;
  if (sessionMode !== "resume") {
    return undefined;
  }
  const reuseAllowed =
    workerRequest.session.reusePolicy === "same-worker-lineage" ||
    workerRequest.session.reusePolicy === "explicit-user-opt-in";
  if (
    reuseAllowed &&
    workerRequest.isolationPolicy.allowUnverifiedReuse === false &&
    evidence?.adapterClaimsCleanSameWorkerLineage === true
  ) {
    return undefined;
  }
  return "resumed session clean lineage not proven";
}

function recursiveDelegationDegradedReason(
  workerRequest: WorkerRequest,
): string | undefined {
  if (
    workerRequest.workerPolicy.allowRecursiveDelegation ||
    !workerRequest.workerPolicy.denyPanelSpawning ||
    workerRequest.workerPolicy.denySubtaskDelegation === false
  ) {
    return "recursive delegation is allowed by worker policy";
  }
  return undefined;
}

function toolsPolicyEquals(
  left: ToolsPolicy | undefined,
  right: ToolsPolicy | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return stableStringify(left) === stableStringify(right);
}
