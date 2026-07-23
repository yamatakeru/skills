import { describe, expect, test } from "bun:test";
import {
  modelAliasTable,
  modelPreferenceToModel,
  parseCursorModels,
  resolveModelEntry,
  resolvePanelComposition,
  type CommandExecutor,
} from "../lib/protocol";
import { opencodeModelsExecutor } from "./fixtures";

describe("Fusion panel composition", () => {
  test("builds the default parent, strong, and efficient slots", async () => {
    const composition = await resolvePanelComposition({
      parentModel: "fable",
      executor: opencodeModelsExecutor([
        "openai/gpt-5.6-sol",
        "opencode-go/deepseek-v4-flash",
      ]),
    });

    expect(composition.panelSpec.workerCount).toBe(3);
    expect(composition.panelSpec.parentModel).toEqual({
      model: "fable",
      fallbacks: ["sonnet", "haiku"],
    });
    expect(
      composition.resolvedModels.map((model) => model.resolvedModelId),
    ).toEqual([
      "fable",
      "openai/gpt-5.6-sol",
      "opencode-go/deepseek-v4-flash",
    ]);
    expect(composition.resolvedModels.map((model) => model.slot)).toEqual([
      "parent",
      "strong",
      "efficient",
    ]);
    expect(composition.panelSpec.workers?.map((worker) => worker.harness)).toEqual([
      { kind: "claude-code", invocation: "headless" },
      { kind: "opencode", invocation: "headless" },
      { kind: "opencode", invocation: "headless" },
    ]);
    expect(composition.harnessSelectionPolicy.userPolicy).toBeUndefined();
  });

  test("advances the strong slot when the parent already uses Sol", async () => {
    const composition = await resolvePanelComposition({
      parentModel: "openai/gpt-5.6-sol",
      executor: opencodeModelsExecutor([
        "openai/gpt-5.6-sol",
        "opencode-go/glm-5.2",
        "opencode-go/deepseek-v4-flash",
      ]),
    });

    expect(
      composition.resolvedModels.map((model) => model.resolvedModelId),
    ).toEqual([
      "openai/gpt-5.6-sol",
      "opencode-go/glm-5.2",
      "opencode-go/deepseek-v4-flash",
    ]);
  });

  test("advances the efficient slot when the parent already uses DeepSeek Flash", async () => {
    const composition = await resolvePanelComposition({
      parentModel: "opencode-go/deepseek-v4-flash",
      executor: opencodeModelsExecutor([
        "opencode-go/deepseek-v4-flash",
        "openai/gpt-5.6-sol",
        "opencode-go/mimo-v2.5",
      ]),
    });

    expect(
      composition.resolvedModels.map((model) => model.resolvedModelId),
    ).toEqual([
      "opencode-go/deepseek-v4-flash",
      "openai/gpt-5.6-sol",
      "opencode-go/mimo-v2.5",
    ]);
  });

  test("falls through to OpenAI models when OpenCode Go models are absent", async () => {
    const composition = await resolvePanelComposition({
      parentModel: "fable",
      executor: opencodeModelsExecutor([
        "openai/gpt-5.6-sol",
        "openai/gpt-5.6-luna",
      ]),
    });

    expect(
      composition.resolvedModels.map((model) => model.resolvedModelId),
    ).toEqual([
      "fable",
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-luna",
    ]);
  });

  test("repeats only the resolved parent for exhausted panels up to size 3", async () => {
    const composition = await resolvePanelComposition({
      parentModel: "fable",
      panelists: 3,
      panelistsExplicit: true,
      opencodeModels: [],
    });

    expect(
      composition.resolvedModels.map((model) => model.resolvedModelId),
    ).toEqual(["fable", "fable", "fable"]);
    expect(composition.resolvedModels.map((model) => model.slot)).toEqual([
      "parent",
      "parent-repeat",
      "parent-repeat",
    ]);
    expect(
      composition.warnings.filter((warning) => warning.includes("degraded")),
    ).toHaveLength(2);
  });

  test("suggests --parent-model when exhausted without a resolved parent", async () => {
    await expect(
      resolvePanelComposition({ opencodeModels: [] }),
    ).rejects.toThrow("--parent-model");
  });

  test("does not repeat the parent for exhausted panels of size 4 or more", async () => {
    await expect(
      resolvePanelComposition({
        parentModel: "fable",
        panelists: 4,
        opencodeModels: [],
      }),
    ).rejects.toThrow("Unable to resolve 4 distinct Fusion models");
  });

  test("keeps duplicate models only for explicit selection", async () => {
    const composition = await resolvePanelComposition({
      models: [
        "opencode:opencode-go/deepseek-v4-flash",
        "opencode:opencode-go/deepseek-v4-flash",
      ],
      executor: opencodeModelsExecutor(["opencode-go/deepseek-v4-flash"]),
    });

    expect(composition.panelSpec.workerCount).toBe(2);
    expect(
      composition.resolvedModels.map((model) => model.resolvedModelId),
    ).toEqual([
      "opencode-go/deepseek-v4-flash",
      "opencode-go/deepseek-v4-flash",
    ]);
  });

  test("resolves a single judge model entry through the panel model router", async () => {
    const model = await resolveModelEntry("opencode:openai/gpt-5.5", {
      executor: opencodeModelsExecutor(["openai/gpt-5.5"]),
    });

    expect(model.harness).toBe("opencode");
    expect(model.kind).toBe("catalog-id");
    expect(model.validatedBy).toBe("harness-list");
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

  test("resolves compatibility aliases through their privacy-eligible chains", async () => {
    const primary = await resolveModelEntry("openai-flagship", {
      executor: opencodeModelsExecutor(["openai/gpt-5.6-sol"]),
    });
    const fallback = await resolveModelEntry("openai-flagship", {
      executor: opencodeModelsExecutor(["openai/gpt-5.4"]),
    });
    const compatibility = await resolveModelEntry("budget-smart", {
      executor: opencodeModelsExecutor(["openai/gpt-5.6-luna"]),
    });

    expect(primary).toMatchObject({
      entry: "openai-flagship",
      kind: "fusion-alias",
      resolvedModelId: "openai/gpt-5.6-sol",
      validatedBy: "harness-list",
      fallbackUsed: false,
    });
    expect(fallback).toMatchObject({
      entry: "openai-flagship",
      kind: "fusion-alias",
      resolvedModelId: "openai/gpt-5.4",
      validatedBy: "harness-list",
      fallbackUsed: true,
    });
    expect(fallback.modelPreference.fallbacks).toEqual([]);
    expect(compatibility).toMatchObject({
      entry: "budget-smart",
      resolvedModelId: "openai/gpt-5.6-luna",
      fallbackUsed: true,
    });
    expect(
      compatibility.modelPreference.fallbacks?.some((model) =>
        model.includes("free"),
      ),
    ).toBe(false);
    expect(aliasCandidates("strong-generalist")).toEqual([
      "openai/gpt-5.6-sol",
      "opencode-go/glm-5.2",
      "opencode-go/deepseek-v4-pro",
      "openai/gpt-5.6-terra",
    ]);
    expect(aliasCandidates("efficient-generalist")).toEqual([
      "opencode-go/deepseek-v4-flash",
      "opencode-go/mimo-v2.5",
      "opencode-go/qwen3.7-plus",
      "opencode-go/minimax-m3",
      "opencode-go/deepseek-v4-pro",
      "openai/gpt-5.6-luna",
    ]);
    expect(aliasCandidates("budget-smart")).toEqual(
      aliasCandidates("efficient-generalist"),
    );
    expect(aliasCandidates("openai-flagship")).toEqual([
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-terra",
      "openai/gpt-5.6-luna",
      "openai/gpt-5.5",
      "openai/gpt-5.4",
    ]);
    expect(
      aliasCandidates("openai-flagship").some((model) =>
        model.includes("-fast"),
      ),
    ).toBe(false);
  });

  test("discloses kind and validation authority for Claude routed entries", async () => {
    const tierAlias = await resolveModelEntry("sonnet");
    const concrete = await resolveModelEntry("claude-opus-4-20250514");

    expect(tierAlias).toMatchObject({
      kind: "tier-alias",
      harness: "claude-code",
      resolvedModelId: "sonnet",
      validatedBy: "pattern",
    });
    expect(concrete).toMatchObject({
      kind: "catalog-id",
      harness: "claude-code",
      resolvedModelId: "claude-opus-4-20250514",
      validatedBy: "pattern",
    });
  });

  test("discloses kind and validation authority for provider-qualified OpenCode entries", async () => {
    const model = await resolveModelEntry("openai/gpt-5.5", {
      executor: opencodeModelsExecutor(["openai/gpt-5.5"]),
    });

    expect(model).toMatchObject({
      kind: "catalog-id",
      harness: "opencode",
      resolvedModelId: "openai/gpt-5.5",
      validatedBy: "harness-list",
    });
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
    expect(composition.resolvedModels[0]).toMatchObject({
      kind: "routing-product",
      validatedBy: "harness-list",
    });
  });

  test("discloses kind and validation authority for forced prefixes", async () => {
    const forcedAlias = await resolveModelEntry("opencode:openai-flagship", {
      executor: opencodeModelsExecutor(["openai/gpt-5.6-sol"]),
    });
    const forcedOpenCode = await resolveModelEntry("opencode:openai/gpt-5.5", {
      executor: opencodeModelsExecutor(["openai/gpt-5.5"]),
    });
    const forcedClaude = await resolveModelEntry("claude-code:fable");
    const forcedCursor = await resolveModelEntry("cursor:sonnet", {
      executor: commandSwitchExecutor({
        cursorModels: ["sonnet - Claude Sonnet"],
      }),
    });

    expect(forcedAlias).toMatchObject({
      kind: "fusion-alias",
      harness: "opencode",
      validatedBy: "harness-list",
    });
    expect(forcedOpenCode).toMatchObject({
      kind: "catalog-id",
      harness: "opencode",
      validatedBy: "harness-list",
    });
    expect(forcedClaude).toMatchObject({
      kind: "tier-alias",
      harness: "claude-code",
      validatedBy: "pattern",
    });
    expect(forcedCursor).toMatchObject({
      kind: "routing-product",
      harness: "cursor",
      validatedBy: "harness-list",
    });
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

function aliasCandidates(alias: string): string[] {
  const preference = modelAliasTable[alias];
  if (preference === undefined) {
    throw new Error(`Expected alias: ${alias}`);
  }
  const primary = modelPreferenceToModel(preference);
  if (primary === undefined) {
    throw new Error(`Expected primary model for alias: ${alias}`);
  }
  return [primary, ...(preference.fallbacks ?? [])];
}

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
