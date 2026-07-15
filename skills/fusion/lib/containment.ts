import type { ContainmentLevel, ToolsPolicy } from "./types";

export function deriveContainment(
  toolsPolicy: ToolsPolicy | undefined,
): ContainmentLevel {
  if (toolsPolicy?.mode === "none") {
    return "no-shell";
  }
  const bashAllowed =
    toolsPolicy?.allow?.some(
      (tool) =>
        tool.toLowerCase() === "bash" || tool.toLowerCase() === "shell",
    ) === true;
  return bashAllowed ? "allowlist-enforced" : "no-shell";
}
