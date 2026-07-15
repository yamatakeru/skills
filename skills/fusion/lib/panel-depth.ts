export const fusionPanelDepthEnv = "FUSION_PANEL_DEPTH";

export const recursiveDelegationDenialMessage =
  "FUSION_RECURSIVE_DELEGATION_DENIED: nested panel/judge invocation from a worker context is denied by the worker contract (recursive delegation denial); see ADR 0037 and issue #10.";

export function nextFusionPanelDepth(
  currentDepth: string | undefined = process.env[fusionPanelDepthEnv],
): string {
  return String(parseFusionPanelDepth(currentDepth) + 1);
}

export function assertTopLevelFusionInvocation(
  currentDepth: string | undefined = process.env[fusionPanelDepthEnv],
): void {
  // Numeric depth leaves room for a future explicit "allow depth N" policy.
  if (parseFusionPanelDepth(currentDepth) >= 1) {
    throw new Error(recursiveDelegationDenialMessage);
  }
}

function parseFusionPanelDepth(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}
