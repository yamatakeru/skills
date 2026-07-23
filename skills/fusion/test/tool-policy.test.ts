import { describe, expect, test } from "bun:test";
import {
  assertNoStrictToolPolicyGap,
  isBashDenied,
  isToolDenied,
  normalizeToolName,
  normalizeToolNameScriptExpression,
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

  test("script expression matches tool-name normalization", () => {
    const evaluate = new Function(
      "name",
      `return ${normalizeToolNameScriptExpression("name")};`,
    ) as (name: string) => string;

    for (const input of [
      "BASH",
      "shell",
      "LS",
      "Web-Fetch",
      "Web-Search",
      "MultiEdit",
      "NotebookEdit",
      "FutureTool",
      " Read ",
    ]) {
      expect(evaluate(input)).toBe(normalizeToolName(input));
    }
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

  test("strict parity rejects effective unknown and command-pattern gaps", () => {
    expect(() =>
      assertNoStrictToolPolicyGap(
        {
          mode: "full",
          deny: ["FutureTool"],
          parity: "strict-same-required",
        },
        "test",
      ),
    ).toThrow("TOOLS_POLICY_STRICT_PARITY_GAP");
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
  });

  test("strict parity ignores gaps disabled by mode or a harness floor", () => {
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
    for (const [deny, floor] of [
      ["FutureTool", "futuretool"],
      ["Bash(rm *)", "bash"],
    ] as const) {
      expect(() =>
        assertNoStrictToolPolicyGap(
          {
            mode: "full",
            deny: [deny],
            parity: "strict-same-required",
          },
          "test",
          (tool) => tool === floor,
        ),
      ).not.toThrow();
    }
  });

  test("strict parity accepts a pattern when the whole tool is denied", () => {
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

  test.each(["same-by-default", undefined] as const)(
    "non-strict parity %p warns without throwing",
    (parity) => {
      const policy = {
        mode: "full" as const,
        deny: ["FutureTool", "Bash(rm *)"],
        ...(parity === undefined ? {} : { parity }),
      };
      expect(() => assertNoStrictToolPolicyGap(policy, "test")).not.toThrow();
      const warnings = toolPolicyWarnings(policy).join("\n");
      expect(warnings).toContain("command-pattern deny entries");
      expect(warnings).toContain("unknown tool names");
    },
  );
});
