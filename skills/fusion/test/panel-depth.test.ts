import { describe, expect, test } from "bun:test";
import {
  assertTopLevelFusionInvocation,
  invalidFusionPanelDepthMessage,
  nextFusionPanelDepth,
  recursiveDelegationDenialMessage,
} from "../lib/protocol";

describe("Fusion panel depth", () => {
  for (const invalid of ["-1", "1.5", "garbage", "NaN"] as const) {
    test(`fails closed for invalid depth ${JSON.stringify(invalid)}`, () => {
      expect(() => nextFusionPanelDepth(invalid)).toThrow(
        invalidFusionPanelDepthMessage,
      );
      expect(() => assertTopLevelFusionInvocation(invalid)).toThrow(
        invalidFusionPanelDepthMessage,
      );
    });
  }

  test("preserves unset, empty, zero, and positive integer behavior", () => {
    expect(nextFusionPanelDepth(undefined)).toBe("1");
    expect(nextFusionPanelDepth("")).toBe("1");
    expect(nextFusionPanelDepth("0")).toBe("1");
    expect(nextFusionPanelDepth("1")).toBe("2");
    expect(() => assertTopLevelFusionInvocation(undefined)).not.toThrow();
    expect(() => assertTopLevelFusionInvocation("")).not.toThrow();
    expect(() => assertTopLevelFusionInvocation("0")).not.toThrow();
    expect(() => assertTopLevelFusionInvocation("1")).toThrow(
      recursiveDelegationDenialMessage,
    );
  });
});
