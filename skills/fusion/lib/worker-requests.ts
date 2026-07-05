import { mergeDefaultPolicies } from "./defaults";
import type {
  DefaultPolicies,
  HarnessDescriptor,
  HarnessKind,
  HarnessSelector,
  ModelPreference,
  PanelRequest,
  WorkerRequest,
} from "./types";
import { validatePanelSpec } from "./validation";

export const defaultHarnessSelector: HarnessSelector = {
  selectHarness({ workerId, modelPreference, policy }): HarnessDescriptor {
    const availableHarnesses = policy.availableHarnesses;
    const forcedHarness = forcedHarnessForWorker(workerId, policy.userPolicy);
    if (forcedHarness !== undefined) {
      if (!isHarnessAvailable(forcedHarness, availableHarnesses)) {
        throw new RangeError(
          `Forced Fusion harness is not available for ${workerId}: ${forcedHarness}`,
        );
      }
      return {
        kind: forcedHarness,
        invocation: "headless",
      };
    }

    if (
      isClaudeModelPreference(modelPreference) &&
      isHarnessAvailable("claude-code", availableHarnesses)
    ) {
      return {
        kind: "claude-code",
        invocation: "headless",
      };
    }

    return {
      kind: selectFallbackHarness(availableHarnesses),
      invocation: "headless",
    };
  },
};

function selectFallbackHarness(
  availableHarnesses: HarnessKind[] | undefined,
): HarnessKind {
  if (availableHarnesses?.length === 0) {
    throw new RangeError(
      "No harnesses are available for Fusion worker selection.",
    );
  }

  if (isHarnessAvailable("opencode", availableHarnesses)) {
    return "opencode";
  }
  return availableHarnesses?.[0] ?? "opencode";
}

function isHarnessAvailable(
  harness: HarnessKind,
  availableHarnesses: HarnessKind[] | undefined,
): boolean {
  return (
    availableHarnesses === undefined || availableHarnesses.includes(harness)
  );
}

function isClaudeModelPreference(
  modelPreference: ModelPreference | undefined,
): boolean {
  return [
    modelPreference?.provider,
    modelPreference?.model,
    ...(modelPreference?.aliases ?? []),
    ...(modelPreference?.fallbacks ?? []),
  ].some(isClaudeModelIdentifier);
}

function isClaudeModelIdentifier(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  const normalized = value.toLowerCase();
  return (
    normalized.includes("claude") ||
    normalized.includes("anthropic") ||
    ["fable", "opus", "sonnet", "haiku"].includes(normalized)
  );
}

function forcedHarnessForWorker(
  workerId: string,
  userPolicy: Record<string, unknown> | undefined,
): HarnessKind | undefined {
  const forcedHarnesses = userPolicy?.fusionForcedHarnesses;
  if (
    forcedHarnesses === undefined ||
    forcedHarnesses === null ||
    typeof forcedHarnesses !== "object" ||
    Array.isArray(forcedHarnesses)
  ) {
    return undefined;
  }

  const forcedHarness = (forcedHarnesses as Record<string, unknown>)[workerId];
  return typeof forcedHarness === "string" ? forcedHarness : undefined;
}

function workerEnvironmentFromPolicy(
  userPolicy: Record<string, unknown> | undefined,
): WorkerRequest["environment"] {
  const environment = userPolicy?.fusionWorkerEnvironment;
  if (
    environment === undefined ||
    environment === null ||
    typeof environment !== "object" ||
    Array.isArray(environment)
  ) {
    return undefined;
  }

  const record = environment as Record<string, unknown>;
  return {
    workspaceRoot:
      typeof record.workspaceRoot === "string"
        ? record.workspaceRoot
        : undefined,
    workingDirectory:
      typeof record.workingDirectory === "string"
        ? record.workingDirectory
        : undefined,
    envProfile:
      typeof record.envProfile === "string" ? record.envProfile : undefined,
  };
}

function workerBudgetFromPolicy(
  userPolicy: Record<string, unknown> | undefined,
): WorkerRequest["budget"] {
  const budget = userPolicy?.fusionWorkerBudget;
  if (
    budget === undefined ||
    budget === null ||
    typeof budget !== "object" ||
    Array.isArray(budget)
  ) {
    return undefined;
  }

  const timeoutMs = (budget as Record<string, unknown>).timeoutMs;
  return typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
    ? { timeoutMs }
    : undefined;
}

export function buildWorkerRequests(
  request: PanelRequest,
  defaults: Partial<DefaultPolicies> = {},
  harnessSelector: HarnessSelector = defaultHarnessSelector,
): WorkerRequest[] {
  validatePanelSpec(request.panelSpec);

  const policies = mergeDefaultPolicies(defaults);
  const environment = workerEnvironmentFromPolicy(
    request.harnessSelectionPolicy.userPolicy,
  );
  const budget = workerBudgetFromPolicy(
    request.harnessSelectionPolicy.userPolicy,
  );
  return Array.from({ length: request.panelSpec.workerCount }, (_, index) => {
    const workerId = `worker-${index + 1}`;
    const modelPreference = request.panelSpec.modelPreferences?.[index];
    const harness = harnessSelector.selectHarness({
      workerId,
      modelPreference,
      policy: request.harnessSelectionPolicy,
    });

    return {
      panelRunId: request.panelRunId,
      workerId,
      prompt: request.prompt,
      sharedContext: request.sharedContext,
      contextManifest: request.contextManifest,
      modelPreference,
      harness,
      session: policies.session,
      isolationPolicy: policies.isolation,
      blindnessPolicy: policies.blindness,
      workerPolicy: policies.worker,
      toolsPolicy: policies.tools,
      environment,
      budget,
      outputContract: policies.output,
      provenancePolicy: request.provenancePolicy ?? policies.provenance,
    };
  });
}
