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

  test("honors a slot harness preference before model-pattern selection", () => {
    expect(
      defaultHarnessSelector.selectHarness({
        workerId: "worker-1",
        modelPreference: { provider: "anthropic", model: "claude-sonnet" },
        harnessPreference: { kind: "opencode", invocation: "headless" },
        policy: { availableHarnesses: ["opencode", "claude-code"] },
      }),
    ).toEqual({ kind: "opencode", invocation: "headless" });
  });

  test("does not select Cursor as a fallback harness", () => {
    expect(() =>
      defaultHarnessSelector.selectHarness({
        workerId: "worker-1",
        policy: { availableHarnesses: ["cursor"] },
      }),
    ).toThrow("Cursor harness selection requires an explicit cursor:");
  });

  test("selects Cursor only from an explicit slot harness preference", () => {
    expect(
      defaultHarnessSelector.selectHarness({
        workerId: "worker-1",
        modelPreference: { model: "composer-2.5-fast" },
        harnessPreference: { kind: "cursor", invocation: "headless" },
        policy: { availableHarnesses: ["cursor"] },
      }),
    ).toEqual({ kind: "cursor", invocation: "headless" });
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
