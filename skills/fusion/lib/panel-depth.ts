export const fusionPanelDepthEnv = "FUSION_PANEL_DEPTH";

export const recursiveDelegationDenialMessage =
  "FUSION_RECURSIVE_DELEGATION_DENIED: nested panel/judge invocation from a worker context is denied by the worker contract (recursive delegation denial); see ADR 0037 and issue #10.";

export const invalidFusionPanelDepthMessage =
  "FUSION_PANEL_DEPTH_INVALID: FUSION_PANEL_DEPTH must be a non-negative integer string.";

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
  if (value === undefined || value === "") {
    return 0;
  }
  if (!/^\d+$/u.test(value)) {
    throw invalidFusionPanelDepth(value);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw invalidFusionPanelDepth(value);
  }
  return parsed;
}

function invalidFusionPanelDepth(value: string): Error {
  return new Error(
    `${invalidFusionPanelDepthMessage} ${JSON.stringify({
      code: "FUSION_PANEL_DEPTH_INVALID",
      value,
    })}`,
  );
}
