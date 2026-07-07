import { describe, expect, test } from "bun:test";
import { AdapterRegistry } from "../lib/protocol";
import { okRunner } from "./fixtures";

describe("Fusion adapter registry", () => {
  test("derives available harnesses from registered adapters", () => {
    const registry = new AdapterRegistry().register("claude-code", okRunner());

    expect(
      registry.selectHarness({
        workerId: "worker-1",
        modelPreference: { model: "claude-sonnet" },
        policy: {},
      }),
    ).toEqual({ kind: "claude-code", invocation: "headless" });
  });

  test("refuses to select an unregistered explicit harness", () => {
    const registry = new AdapterRegistry().register("opencode", okRunner());

    expect(() =>
      registry.selectHarness({
        workerId: "worker-1",
        harnessPreference: { kind: "claude-code", invocation: "headless" },
        policy: {},
      }),
    ).toThrow("not registered");
  });
});
