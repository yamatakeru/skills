import { mergeDefaultPolicies } from "./defaults";
import type {
  DefaultPolicies,
  HarnessDescriptor,
  HarnessSelector,
  PanelRequest,
  WorkerRequest,
} from "./types";
import { validatePanelSpec } from "./validation";

export const defaultHarnessSelector: HarnessSelector = {
  selectHarness: (): HarnessDescriptor => ({
    kind: "direct-api",
    invocation: "api",
  }),
};

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
