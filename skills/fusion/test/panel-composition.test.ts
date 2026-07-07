import { describe, expect, test } from "bun:test";
import {
  parseCursorModels,
  resolveModelEntry,
  resolvePanelComposition,
  type CommandExecutor,
} from "../lib/protocol";
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
    expect(composition.panelSpec.workers?.map((worker) => worker.harness)).toEqual([
      { kind: "claude-code", invocation: "headless" },
      { kind: "opencode", invocation: "headless" },
      { kind: "opencode", invocation: "headless" },
    ]);
    expect(composition.harnessSelectionPolicy.userPolicy).toBeUndefined();
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

  test("resolves cursor entries only through the explicit cursor prefix", async () => {
    const composition = await resolvePanelComposition({
      models: ["cursor:composer-2.5-fast"],
      executor: commandSwitchExecutor({
        cursorModels: ["composer-2.5-fast - Composer 2.5 Fast"],
      }),
    });

    expect(composition.panelSpec.workers).toEqual([
      {
        model: { model: "composer-2.5-fast", fallbacks: [] },
        harness: { kind: "cursor", invocation: "headless" },
      },
    ]);
    expect(composition.harnessSelectionPolicy.availableHarnesses).toEqual([
      "cursor",
    ]);
    expect(composition.cursorModels).toEqual(["composer-2.5-fast"]);
  });

  test("rejects bare cursor-family names and cursor-prefixed aliases", async () => {
    await expect(
      resolvePanelComposition({
        models: ["composer-2.5-fast"],
      }),
    ).rejects.toThrow("Unrecognized Fusion model entry");

    await expect(
      resolvePanelComposition({
        models: ["cursor:openai-flagship"],
      }),
    ).rejects.toThrow("concrete cursor model id");
  });

  test("checks cursor model availability with cursor-agent models", async () => {
    await expect(
      resolveModelEntry("cursor:missing-model", {
        executor: commandSwitchExecutor({
          cursorModels: ["composer-2.5-fast - Composer 2.5 Fast"],
        }),
      }),
    ).rejects.toThrow("Cursor model is not available");
  });

  test("parses cursor-agent model id lines", () => {
    expect(
      parseCursorModels(
        [
          "composer-2.5-fast - Composer 2.5 Fast",
          "gpt-5 - GPT-5",
          "not a model line",
          "\u001b[32msonnet-4-thinking - Claude Sonnet 4 Thinking\u001b[0m",
        ].join("\n"),
      ),
    ).toEqual(["composer-2.5-fast", "gpt-5", "sonnet-4-thinking"]);
  });

  test("rejects unrecognized model entries instead of guessing", async () => {
    await expect(
      resolvePanelComposition({ models: ["mystery-model"] }),
    ).rejects.toThrow("Unrecognized Fusion model entry");
  });
});

function commandSwitchExecutor(options: {
  opencodeModels?: string[];
  cursorModels?: string[];
}): CommandExecutor {
  return async (execution) => {
    if (execution.command === "opencode" && execution.args[0] === "models") {
      return {
        exitCode: 0,
        stdout: `${(options.opencodeModels ?? []).join("\n")}\n`,
        stderr: "",
        durationMs: 1,
      };
    }
    if (
      execution.command === "cursor-agent" &&
      execution.args[0] === "models"
    ) {
      return {
        exitCode: 0,
        stdout: `${(options.cursorModels ?? []).join("\n")}\n`,
        stderr: "",
        durationMs: 1,
      };
    }
    throw new Error(`unexpected command: ${execution.command}`);
  };
}
