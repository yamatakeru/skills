import { describe, expect, test } from "bun:test";
import { resolveModelEntry, resolvePanelComposition } from "../lib/protocol";
import { opencodeModelsExecutor } from "./fixtures";

describe("Fusion panel composition", () => {
  test("builds the default parent, flagship, and budget slots", async () => {
    const composition = await resolvePanelComposition({
      parentModel: "sonnet",
      executor: opencodeModelsExecutor([
        "openai/gpt-5.5",
        "opencode/deepseek-v4-flash-free",
      ]),
    });

    expect(composition.panelSpec.workerCount).toBe(3);
    expect(composition.panelSpec.parentModel).toEqual({
      model: "sonnet",
      fallbacks: ["haiku"],
    });
    expect(
      composition.resolvedModels.map((model) => model.resolvedModelId),
    ).toEqual(["sonnet", "openai/gpt-5.5", "opencode/deepseek-v4-flash-free"]);
    expect(
      composition.harnessSelectionPolicy.userPolicy?.fusionForcedHarnesses,
    ).toEqual({
      "worker-1": "claude-code",
      "worker-2": "opencode",
      "worker-3": "opencode",
    });
  });

  test("warns and refills when the parent model is omitted", async () => {
    const composition = await resolvePanelComposition({
      executor: opencodeModelsExecutor([
        "openai/gpt-5.5",
        "openai/gpt-5.5-fast",
        "opencode/deepseek-v4-flash-free",
      ]),
    });

    expect(composition.warnings.join("\n")).toContain("No --parent-model");
    expect(
      new Set(composition.resolvedModels.map((model) => model.resolvedModelId))
        .size,
    ).toBe(3);
    expect(
      composition.resolvedModels.map((model) => model.resolvedModelId),
    ).toEqual([
      "openai/gpt-5.5",
      "opencode/deepseek-v4-flash-free",
      "openai/gpt-5.5-fast",
    ]);
  });

  test("dedupes default model ids and refills from fallback entries", async () => {
    const composition = await resolvePanelComposition({
      parentModel: "openai/gpt-5.5",
      executor: opencodeModelsExecutor([
        "openai/gpt-5.5",
        "openai/gpt-5.4",
        "opencode/deepseek-v4-flash-free",
      ]),
    });

    expect(
      composition.resolvedModels.map((model) => model.resolvedModelId),
    ).toEqual([
      "openai/gpt-5.5",
      "openai/gpt-5.4",
      "opencode/deepseek-v4-flash-free",
    ]);
  });

  test("keeps duplicate models only for explicit selection", async () => {
    const composition = await resolvePanelComposition({
      models: [
        "opencode:opencode/deepseek-v4-flash-free",
        "opencode:opencode/deepseek-v4-flash-free",
      ],
      executor: opencodeModelsExecutor(["opencode/deepseek-v4-flash-free"]),
    });

    expect(composition.panelSpec.workerCount).toBe(2);
    expect(
      composition.resolvedModels.map((model) => model.resolvedModelId),
    ).toEqual([
      "opencode/deepseek-v4-flash-free",
      "opencode/deepseek-v4-flash-free",
    ]);
  });

  test("resolves a single judge model entry through the panel model router", async () => {
    const model = await resolveModelEntry("opencode:openai/gpt-5.5", {
      executor: opencodeModelsExecutor(["openai/gpt-5.5"]),
    });

    expect(model.harness).toBe("opencode");
    expect(model.modelPreference).toEqual({
      provider: "openai",
      model: "gpt-5.5",
      fallbacks: [],
    });
  });

  test("can reuse known OpenCode models when resolving a single judge entry", async () => {
    const model = await resolveModelEntry("opencode:openai/gpt-5.5", {
      opencodeModels: ["openai/gpt-5.5"],
      executor: async () => {
        throw new Error("opencode models should not be called");
      },
    });

    expect(model.resolvedModelId).toBe("openai/gpt-5.5");
  });

  test("rejects unrecognized model entries instead of guessing", async () => {
    await expect(
      resolvePanelComposition({ models: ["mystery-model"] }),
    ).rejects.toThrow("Unrecognized Fusion model entry");
  });
});
