import type { ContainmentLevel, ToolsPolicy } from "./types";
import { isBashDenied, normalizeToolName } from "./tool-policy";

export function deriveContainment(
  toolsPolicy: ToolsPolicy | undefined,
): ContainmentLevel | undefined {
  if (toolsPolicy?.mode === "none" || isBashDenied(toolsPolicy)) {
    return "no-shell";
  }
  if (toolsPolicy?.mode === "full") {
    return undefined;
  }
  const bashAllowed =
    toolsPolicy?.allow?.some(
      (tool) => normalizeToolName(tool) === "bash",
    ) === true;
  return bashAllowed ? "allowlist-enforced" : "no-shell";
}
