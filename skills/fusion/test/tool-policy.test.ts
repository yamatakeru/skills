import { describe, expect, test } from "bun:test";
import {
  assertNoStrictToolPolicyGap,
  isBashDenied,
  isToolDenied,
  normalizeToolName,
  toolPolicyWarnings,
} from "../lib/protocol";

describe("ToolsPolicy deny-wins helpers", () => {
  test.each([
    ["BASH", "bash"],
    ["shell", "bash"],
    ["LS", "list"],
    ["web-fetch", "webfetch"],
    ["WEB-SEARCH", "websearch"],
    ["MultiEdit", "edit"],
    ["NotebookEdit", "edit"],
    ["UnknownTool", "unknowntool"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeToolName(input)).toBe(expected);
  });

  test("deny wins over an overlapping allow in every mode", () => {
    for (const mode of ["none", "read-only", "limited", "full"] as const) {
      const policy = { mode, allow: ["Read"], deny: ["read"] };
      expect(isToolDenied(policy, "READ")).toBe(true);
    }
  });

  test("treats shell aliases as a whole-Bash denial", () => {
    const policy = {
      mode: "read-only" as const,
      allow: ["Bash"],
      deny: ["SHELL"],
      readOnlyBashCommands: ["git status"],
    };
    expect(isBashDenied(policy)).toBe(true);
    expect(toolPolicyWarnings(policy).join("\n")).toContain(
      "discarded readOnlyBashCommands",
    );
  });

  test("discloses unknown names without weakening deny checks", () => {
    const policy = { mode: "full" as const, deny: ["FutureTool"] };
    expect(isToolDenied(policy, "futuretool")).toBe(true);
    expect(toolPolicyWarnings(policy).join("\n")).toContain("unknown tool names");
  });

  test("strict parity fails only for an effective unsupported pattern gap", () => {
    expect(() =>
      assertNoStrictToolPolicyGap(
        {
          mode: "full",
          deny: ["Bash(rm *)"],
          parity: "strict-same-required",
        },
        "test",
      ),
    ).toThrow("TOOLS_POLICY_STRICT_PARITY_GAP");
    expect(() =>
      assertNoStrictToolPolicyGap(
        {
          mode: "none",
          deny: ["Bash(rm *)"],
          parity: "strict-same-required",
        },
        "test",
      ),
    ).not.toThrow();
    expect(() =>
      assertNoStrictToolPolicyGap(
        {
          mode: "full",
          deny: ["Bash(rm *)"],
          parity: "strict-same-required",
        },
        "test",
        (tool) => tool === "bash",
      ),
    ).not.toThrow();
    expect(() =>
      assertNoStrictToolPolicyGap(
        {
          mode: "full",
          deny: ["Bash", "Bash(rm *)"],
          parity: "strict-same-required",
        },
        "test",
      ),
    ).not.toThrow();
  });
});
