import { describe, expect, test } from "bun:test";
import { defaultHarnessSelector } from "../lib/protocol";

describe("Fusion harness selection", () => {
  test("defaults to OpenCode when no harness list is provided", () => {
    expect(
      defaultHarnessSelector.selectHarness({
        workerId: "worker-1",
        policy: {},
      }),
    ).toEqual({ kind: "opencode", invocation: "headless" });
  });

  test("prefers Claude Code for Claude-family model preferences when available", () => {
    expect(
      defaultHarnessSelector.selectHarness({
        workerId: "worker-1",
        modelPreference: { provider: "anthropic", model: "claude-sonnet" },
        policy: { availableHarnesses: ["opencode", "claude-code"] },
      }),
    ).toEqual({ kind: "claude-code", invocation: "headless" });
  });

  test("fails when the caller explicitly provides no available harnesses", () => {
    expect(() =>
      defaultHarnessSelector.selectHarness({
        workerId: "worker-1",
        policy: { availableHarnesses: [] },
      }),
    ).toThrow("No harnesses are available");
  });
});
