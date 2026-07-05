import { mergeDefaultPolicies } from "./defaults";
import { renderWorkerPrompt } from "./worker-prompt";
import type {
  DefaultPolicies,
  ContextManifest,
  HarnessDescriptor,
  HarnessKind,
  HarnessSelector,
  ModelPreference,
  PanelRequest,
  WorkerRequest,
} from "./types";
import { validatePanelSpec } from "./validation";

export type WorkerRequestBuildInput = Omit<PanelRequest, "contextManifest"> & {
  contextManifest?: ContextManifest;
};

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

export const claudeModelAliases = ["fable", "opus", "sonnet", "haiku"];

function isClaudeModelIdentifier(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  const normalized = value.toLowerCase();
  return (
    normalized.includes("claude") ||
    normalized.includes("anthropic") ||
    claudeModelAliases.includes(normalized)
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

export function buildWorkerRequests(
  request: WorkerRequestBuildInput,
  defaults: Partial<DefaultPolicies> = {},
  harnessSelector: HarnessSelector = defaultHarnessSelector,
): WorkerRequest[] {
  validatePanelSpec(request.panelSpec);

  const policies = mergeDefaultPolicies(defaults);
  const renderedPrompt = renderWorkerPrompt({
    task: request.prompt,
    outputContract: policies.output,
    sharedContext: request.sharedContext,
  });
  return Array.from({ length: request.panelSpec.workerCount }, (_, index) => {
    const workerId = `worker-${index + 1}`;
    const modelPreference = request.panelSpec.modelPreferences?.[index];
    const harness = harnessSelector.selectHarness({
      workerId,
      modelPreference,
      policy: request.harnessSelectionPolicy,
    });

    return buildWorkerRequestBase({
      request,
      policies,
      workerId,
      prompt: renderedPrompt,
      modelPreference,
      harness,
    });
  });
}

export function buildWorkerRequestBase(input: {
  request: WorkerRequestBuildInput;
  policies: DefaultPolicies;
  workerId: string;
  prompt: string;
  modelPreference?: ModelPreference;
  harness?: HarnessDescriptor;
  contextManifest?: WorkerRequest["contextManifest"];
}): WorkerRequest {
  return {
    panelRunId: input.request.panelRunId,
    workerId: input.workerId,
    prompt: input.prompt,
    sharedContext: input.request.sharedContext,
    contextManifest: input.contextManifest ?? input.request.contextManifest,
    modelPreference: input.modelPreference,
    harness: input.harness,
    session: input.policies.session,
    isolationPolicy: input.policies.isolation,
    blindnessPolicy: input.policies.blindness,
    workerPolicy: input.policies.worker,
    toolsPolicy: input.policies.tools,
    reasoning: input.request.reasoning,
    environment: input.request.workerEnvironment,
    budget: input.request.workerBudget,
    outputContract: input.policies.output,
    provenancePolicy:
      input.request.provenancePolicy ?? input.policies.provenance,
  };
}
