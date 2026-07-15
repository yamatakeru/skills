import type { ContainmentLevel, ToolsPolicy } from "./types";

export function deriveContainment(
  toolsPolicy: ToolsPolicy | undefined,
): ContainmentLevel | undefined {
  if (toolsPolicy?.mode === "full") {
    return undefined;
  }
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
