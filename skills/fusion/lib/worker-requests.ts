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
  selectHarness({ modelPreference, policy }): HarnessDescriptor {
    const availableHarnesses = policy.availableHarnesses;

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
  return normalized.includes("claude") || normalized.includes("anthropic");
}

export function buildWorkerRequests(
  request: PanelRequest,
  defaults: Partial<DefaultPolicies> = {},
  harnessSelector: HarnessSelector = defaultHarnessSelector,
): WorkerRequest[] {
  validatePanelSpec(request.panelSpec);

  const policies = mergeDefaultPolicies(defaults);
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
      outputContract: policies.output,
      provenancePolicy: request.provenancePolicy ?? policies.provenance,
    };
  });
}
