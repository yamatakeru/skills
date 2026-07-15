import { describeJudgeInvocation } from "./judge-synthesizer";
import { deriveContainment } from "./containment";
import { notApplicableWatchdogEvidence } from "./watchdog";
import type {
  ComplianceSummary,
  ComplianceTier,
  JudgeCompliance,
  PanelRequest,
  ProvenanceEvent,
  ProvenanceEventType,
  SessionMode,
  SynthesisResult,
  WorkerCompliance,
  WorkerComplianceEvidence,
  WorkerRequest,
  WorkerResult,
  WorkspaceWatchdogEvidence,
} from "./types";

export function evaluateCompliance(input: {
  panelRequest: PanelRequest;
  workerRequests: WorkerRequest[];
  workerResults: WorkerResult[];
  events: ProvenanceEvent[];
  synthesisResult?: SynthesisResult;
  workspaceWatchdog?: WorkspaceWatchdogEvidence;
}): ComplianceSummary {
  const workspaceWatchdog =
    input.workspaceWatchdog ??
    notApplicableWatchdogEvidence(
      input.panelRequest.workerEnvironment?.workspaceRoot ?? process.cwd(),
    );
  const missingRequiredEvents = findMissingRequiredEvents(input);
  const failedWorkers = input.workerResults
    .filter((result) => result.status !== "ok")
    .map((result) => result.workerId);
  const corroboratingWorkerIds = new Set(
    workspaceWatchdog.verdict === "mutated"
      ? input.workerResults
          .filter((result) =>
            hasCorroboratingMutationEvent(result, workspaceWatchdog),
          )
          .map((result) => result.workerId)
      : [],
  );
  const workerCompliance = input.workerRequests.map((workerRequest) => {
    const result = input.workerResults.find(
      (candidate) => candidate.workerId === workerRequest.workerId,
    );
    const compliance = evaluateWorkerCompliance(
      workerRequest,
      result,
      missingRequiredEvents,
    );
    if (corroboratingWorkerIds.has(workerRequest.workerId)) {
      compliance.tier = "non-compliant";
      compliance.degradedReason = appendReason(
        compliance.degradedReason,
        "successful worker shell event corroborates the observed workspace mutation",
      );
    }
    return {
      workerId: workerRequest.workerId,
      compliance,
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
    watchdogMutated: workspaceWatchdog.verdict === "mutated",
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
  if (workspaceWatchdog.verdict === "mutated") {
    notes.push(workspaceWatchdog.note);
    if (corroboratingWorkerIds.size > 0) {
      notes.push(
        `Workspace mutation was corroborated by successful shell events from: ${[...corroboratingWorkerIds].join(", ")}.`,
      );
    }
  }

  return {
    tier,
    workerCompliance,
    judgeCompliance: evaluateJudgeCompliance(input.synthesisResult),
    degradedWorkers: degradedWorkers.length === 0 ? undefined : degradedWorkers,
    failedWorkers: failedWorkers.length === 0 ? undefined : failedWorkers,
    missingRequiredEvents:
      missingRequiredEvents.length === 0 ? undefined : missingRequiredEvents,
    workspaceWatchdog,
    notes: notes.length === 0 ? undefined : notes,
  };
}

function evaluateJudgeCompliance(
  synthesisResult: SynthesisResult | undefined,
): JudgeCompliance | undefined {
  const judgeRequest = synthesisResult?.judgeRequest;
  if (judgeRequest === undefined) {
    return undefined;
  }
  const judge = describeJudgeInvocation(synthesisResult);

  return {
    workerId: judgeRequest.workerId,
    status: judge.status,
    modelUsed: judge.modelUsed,
    harnessUsed: judge.harnessUsed,
    toolsPolicy: judgeRequest.toolsPolicy,
    notes: [
      "Judge invocation is recorded separately from blind panel worker compliance.",
      judgeRequest.toolsPolicy === undefined
        ? "Judge tools policy was not recorded on the request."
        : judgeRequest.toolsPolicy.mode === "none"
          ? "Judge requested a no-tools policy."
          : "Judge requested a non-no-tools policy.",
    ],
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
  const enforcementSource = evidence?.enforcement?.source;
  const containment =
    evidence?.containment ?? deriveContainment(workerRequest.toolsPolicy);
  const violationEvidence = evidence?.enforcement?.violationEvidence ?? [];
  const workerMissingRequiredEvents = missingRequiredEvents.some((event) =>
    event.endsWith(`:${workerRequest.workerId}`),
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
    enforcementSource === undefined
      ? "runtime enforcement source not recorded"
      : undefined,
    resumeSessionDegradedReason(workerRequest, evidence),
    recursiveDelegationDegradedReason(workerRequest),
  ].filter((reason): reason is string => reason !== undefined);

  return {
    tier:
      violationEvidence.length > 0
        ? "non-compliant"
        : degradedReasons.length === 0
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
    enforcementSource,
    containment,
    degradedReason:
      violationEvidence.length > 0
        ? `runtime violation evidence: ${violationEvidence.join("; ")}`
        : degradedReasons.length === 0
          ? undefined
          : degradedReasons.join("; "),
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
  watchdogMutated: boolean;
}): ComplianceTier {
  if (input.hasNonCompliantWorker) {
    return "non-compliant";
  }
  if (
    input.hasMissingRequiredEvents ||
    input.hasFailedWorkers ||
    input.hasDegradedWorker ||
    input.hasTooFewWorkers ||
    input.watchdogMutated
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
  synthesisResult?: SynthesisResult;
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
    (input.synthesisResult?.synthesis.length ?? 0) > 0 &&
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

function hasCorroboratingMutationEvent(
  result: WorkerResult,
  watchdog: WorkspaceWatchdogEvidence,
): boolean {
  return (result.complianceEvidence?.enforcement?.toolEvents ?? []).some(
    (event) => {
      if (
        event.outcome !== "succeeded" ||
        !["bash", "shell"].includes(event.tool.toLowerCase()) ||
        event.command === undefined
      ) {
        return false;
      }
      return commandCanExplainMutation(event.command, watchdog);
    },
  );
}

function commandCanExplainMutation(
  command: string,
  watchdog: WorkspaceWatchdogEvidence,
): boolean {
  const mutatesRefs = /\bgit\s+(?:commit|branch|tag|push|update-ref|reset|merge|rebase|cherry-pick|checkout|switch)\b/u;
  if ((watchdog.refDiffs?.length ?? 0) > 0 && mutatesRefs.test(command)) {
    return true;
  }
  if ((watchdog.changedPaths?.length ?? 0) === 0) {
    return false;
  }
  const redirect = /(?:^|[^>=])(?:\d*>{1,2}|&>)(?![=])/u.test(command);
  const plausiblyMutatesPaths =
    mutatesRefs.test(command) ||
    /\b(?:rm|mv|cp|touch|mkdir|rmdir|truncate|tee|install)\b/u.test(command) ||
    /\bsed\b.*(?:\s-i\b|--in-place)/u.test(command) ||
    redirect;
  const mentionsChangedPath = (watchdog.changedPaths ?? []).some((path) => {
    const basename = path.replaceAll("\\", "/").split("/").at(-1);
    return command.includes(path) ||
      (basename !== undefined && command.includes(basename));
  });
  return (
    plausiblyMutatesPaths &&
    (mentionsChangedPath || redirect)
  );
}

function appendReason(
  existing: string | undefined,
  reason: string,
): string {
  return existing === undefined ? reason : `${existing}; ${reason}`;
}
