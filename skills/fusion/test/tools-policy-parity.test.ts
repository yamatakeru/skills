import { describe, expect, test } from "bun:test";
import {
  assertNoStrictToolPolicyGap,
  buildClaudeCodeArgs,
  buildCursorConfigContent,
  buildOpenCodePermissionMap,
  cursorHookDeniesAllTools,
  cursorHookDeniedToolNames,
  cursorShellAllowlist,
  toolPolicyWarnings,
  type ToolsPolicy,
} from "../lib/protocol";
import { workerRequest } from "./fixtures";

type Capability = "bash" | "read" | "edit" | "webfetch";
type Harness = "opencode" | "claude" | "cursor";

function effectiveCapabilities(
  policy: ToolsPolicy,
): Record<Harness, Record<Capability, boolean>> {
  const openCode = buildOpenCodePermissionMap(policy, undefined);
  const claudeArgs = buildClaudeCodeArgs({ ...workerRequest(), toolsPolicy: policy });
  const cursor = buildCursorConfigContent("worker", policy).permissions.deny;
  const cursorHookDenied = cursorHookDeniedToolNames(policy);
  const cursorDenyAll = cursorHookDeniesAllTools(policy);
  const claudeTools = claudeArgs
    .filter((arg) => arg.startsWith("--tools="))
    .flatMap((arg) => arg.slice("--tools=".length).split(","));
  const claudeDenied = claudeArgs
    .filter((arg) => arg.startsWith("--disallowedTools="))
    .flatMap((arg) => arg.slice("--disallowedTools=".length).split(","))
    .map((tool) => tool.toLowerCase());
  const claudeEnabled = (tools: string[]) =>
    policy.mode !== "none" &&
    !claudeDenied.some((denied) => tools.includes(denied)) &&
    (policy.mode === "full" ||
      tools.some((tool) => claudeTools.map((value) => value.toLowerCase()).includes(tool)));
  const cursorEnabled = (tool: Capability) =>
    !cursorDenyAll && !cursorHookDenied.includes(tool);
  return {
    opencode: {
      bash:
        typeof openCode.bash !== "string" &&
        Object.values(openCode.bash).includes("allow"),
      read: openCode.read === "allow",
      edit: openCode.edit === "allow",
      webfetch: openCode.webfetch === "allow",
    },
    claude: {
      bash: claudeEnabled(["bash"]),
      read: claudeEnabled(["read"]),
      edit: claudeEnabled(["edit", "multiedit", "notebookedit"]),
      webfetch: claudeEnabled(["webfetch", "web-fetch"]),
    },
    cursor: {
      bash:
        cursorEnabled("bash") &&
        !cursor.includes("Shell(**)") &&
        cursorShellAllowlist({ ...workerRequest(), toolsPolicy: policy }).length > 0,
      read: cursorEnabled("read") && !cursor.includes("Read(**)"),
      edit: cursorEnabled("edit") && !cursor.includes("Write(**)"),
      webfetch: cursorEnabled("webfetch"),
    },
  };
}

describe("cross-adapter ToolsPolicy parity", () => {
  test.each([
    {
      label: "allow and deny both contain Bash",
      policy: { mode: "read-only", allow: ["Read", "Bash"], deny: ["bash"], readOnlyBashCommands: ["git status"] },
      expected: { bash: false, read: true },
    },
    {
      label: "read-only shell commands plus Bash deny",
      policy: { mode: "limited", deny: ["shell"], readOnlyBashCommands: ["ls"] },
      expected: { bash: false },
    },
    {
      label: "full minus Bash and WebFetch",
      policy: { mode: "full", deny: ["Bash", "WebFetch"] },
      expected: { bash: false, read: true, webfetch: false },
    },
    {
      label: "none ignores contradictory allow",
      policy: { mode: "none", allow: ["Read", "Bash"], deny: [] },
      expected: { bash: false, read: false, edit: false, webfetch: false },
    },
    {
      label: "edit aliases share a deny family",
      policy: { mode: "limited", allow: ["MultiEdit"], deny: ["notebookedit"] },
      expected: { bash: false, edit: false },
    },
  ] as Array<{ label: string; policy: ToolsPolicy; expected: Partial<Record<Capability, boolean>> }>) (
    "$label",
    ({ policy, expected }) => {
      const effective = effectiveCapabilities(policy);
      for (const harness of ["opencode", "claude", "cursor"] as const) {
        for (const [capability, enabled] of Object.entries(expected)) {
          expect(effective[harness][capability as Capability]).toBe(enabled);
        }
      }
    },
  );

  test("hook-only and unknown names are disclosed non-strictly and unknown names fail strict parity", () => {
    const policy: ToolsPolicy = {
      mode: "full",
      deny: ["WebFetch", "FutureTool"],
      parity: "same-by-default",
    };
    expect(() => buildCursorConfigContent("worker", policy)).not.toThrow();
    expect(toolPolicyWarnings(policy).join("\n")).toContain("unknown tool names");
    for (const effective of Object.values(effectiveCapabilities(policy))) {
      expect(effective.webfetch).toBe(false);
    }
    expect(() =>
      assertNoStrictToolPolicyGap(
        { ...policy, parity: "strict-same-required" },
        "cross-adapter",
      ),
    ).toThrow("TOOLS_POLICY_STRICT_PARITY_GAP");
  });

  test("judge no-tools policy has no strict parity gap", () => {
    const policy: ToolsPolicy = {
      mode: "none",
      allow: [],
      deny: ["Read", "Grep", "Glob", "WebFetch", "FutureTool"],
      parity: "strict-same-required",
    };
    for (const effective of Object.values(effectiveCapabilities(policy))) {
      expect(effective).toEqual({
        bash: false,
        read: false,
        edit: false,
        webfetch: false,
      });
    }
  });
});
