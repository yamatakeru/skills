import type { ToolsPolicy } from "./types";

const aliases: Readonly<Record<string, string>> = {
  shell: "bash",
  ls: "list",
  "web-fetch": "webfetch",
  "web-search": "websearch",
  multiedit: "edit",
  notebookedit: "edit",
};

const knownToolNames = new Set([
  "bash",
  "delete",
  "doom_loop",
  "edit",
  "glob",
  "grep",
  "list",
  "lsp",
  "mcp",
  "patch",
  "read",
  "skill",
  "task",
  "todowrite",
  "webfetch",
  "websearch",
  "write",
]);

export function normalizeToolName(name: string): string {
  const normalized = name.trim().toLowerCase();
  return aliases[normalized] ?? normalized;
}

export function isToolDenied(
  policy: ToolsPolicy | undefined,
  name: string,
): boolean {
  const normalized = normalizeToolName(name);
  return (policy?.deny ?? []).some(
    (denied) => normalizeToolName(denied) === normalized,
  );
}

export function isBashDenied(policy: ToolsPolicy | undefined): boolean {
  return isToolDenied(policy, "bash");
}

export function canonicalDeniedToolNames(
  policy: ToolsPolicy | undefined,
): string[] {
  return unique((policy?.deny ?? []).map(normalizeToolName));
}

export function unknownDeniedToolNames(
  policy: ToolsPolicy | undefined,
): string[] {
  return canonicalDeniedToolNames(policy).filter(
    (name) => !knownToolNames.has(name) && !isCommandPatternDeny(name),
  );
}

export function unsupportedCommandPatternDenies(
  policy: ToolsPolicy | undefined,
): string[] {
  return unique(
    (policy?.deny ?? []).filter((name) => isCommandPatternDeny(name)),
  );
}

export function toolPolicyWarnings(
  policy: ToolsPolicy | undefined,
): string[] {
  const warnings: string[] = [];
  if (
    isBashDenied(policy) &&
    (policy?.readOnlyBashCommands?.length ?? 0) > 0
  ) {
    warnings.push(
      `ToolsPolicy deny disables Bash; discarded readOnlyBashCommands: ${policy?.readOnlyBashCommands?.join(", ")}.`,
    );
  }
  const unsupported = unsupportedCommandPatternDenies(policy);
  if (unsupported.length > 0) {
    warnings.push(
      `ToolsPolicy parity limitation: command-pattern deny entries are unsupported and were not enforced: ${unsupported.join(", ")}.`,
    );
  }
  const unknown = unknownDeniedToolNames(policy);
  if (unknown.length > 0) {
    warnings.push(
      `ToolsPolicy parity limitation: deny contains unknown tool names whose harness vocabulary cannot be verified: ${unknown.join(", ")}.`,
    );
  }
  return warnings;
}

export function assertNoStrictToolPolicyGap(
  policy: ToolsPolicy | undefined,
  harness: string,
  isDeniedByHarnessFloor: (tool: string) => boolean = () => false,
): void {
  if (policy?.parity !== "strict-same-required") {
    return;
  }
  const unknownGaps = unknownDeniedToolNames(policy).filter(
    (name) =>
      !isDeniedByHarnessFloor(name) && isBaseToolEnabled(policy, name),
  );
  const commandPatternGaps = unsupportedCommandPatternDenies(policy).filter(
    (deny) => {
      const tool = normalizeToolName(deny.slice(0, deny.search(/[()]/u)));
      return (
        !isToolDenied(policy, tool) &&
        !isDeniedByHarnessFloor(tool) &&
        isBaseToolEnabled(policy, tool)
      );
    },
  );
  const gaps = [...unknownGaps, ...commandPatternGaps];
  if (gaps.length > 0) {
    throw new ToolsPolicyParityError(harness, gaps);
  }
}

export class ToolsPolicyParityError extends Error {
  constructor(harness: string, deny: string[]) {
    super(
      `ToolsPolicy strict parity gap: ${JSON.stringify({
        code: "TOOLS_POLICY_STRICT_PARITY_GAP",
        harness,
        deny,
        limitation: "deny entry cannot be verifiably enforced",
      })}`,
    );
    this.name = "ToolsPolicyParityError";
  }
}

export function normalizeToolNameScriptExpression(expression: string): string {
  const normalized = `${expression}.trim().toLowerCase()`;
  return `(${JSON.stringify(aliases)}[${normalized}] || ${normalized})`;
}

function isCommandPatternDeny(name: string): boolean {
  return /[()]/u.test(name);
}

function isBaseToolEnabled(policy: ToolsPolicy, tool: string): boolean {
  if (policy.mode === "none") {
    return false;
  }
  if (policy.mode === "full") {
    return true;
  }
  if (
    tool === "bash" &&
    (policy.readOnlyBashCommands?.length ?? 0) > 0
  ) {
    return true;
  }
  const allow =
    policy.allow ??
    (policy.mode === "read-only"
      ? ["read", "grep", "glob", "list", "webfetch", "websearch", "bash"]
      : []);
  return allow.some((allowed) => normalizeToolName(allowed) === tool);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
