import {
  executeCommand,
  modelPreferenceToModel,
  snippet,
  type CommandExecutor,
} from "./headless-cli-adapters";
import type {
  HarnessKind,
  HarnessSelectionPolicy,
  ModelPreference,
  PanelSpec,
} from "./types";
import { claudeModelAliases } from "./worker-requests";

export const DEFAULT_PANEL_SIZE = 3;

export const modelAliasTable: Record<string, ModelPreference> = {
  "openai-flagship": {
    provider: "openai",
    model: "gpt-5.5",
    aliases: ["openai-flagship"],
    fallbacks: ["openai/gpt-5.5-fast", "openai/gpt-5.4"],
  },
  "budget-smart": {
    provider: "opencode",
    model: "deepseek-v4-flash-free",
    aliases: ["budget-smart"],
    fallbacks: [
      "opencode/mimo-v2.5-free",
      "opencode/north-mini-code-free",
      "opencode/nemotron-3-ultra-free",
    ],
  },
};

export interface ResolvePanelCompositionOptions {
  parentModel?: string;
  models?: string[];
  panelists?: number;
  panelistsExplicit?: boolean;
  opencodeCommand?: string;
  cursorCommand?: string;
  executor?: CommandExecutor;
  cwd?: string;
  opencodeModels?: string[];
  cursorModels?: string[];
}

export interface ResolvedPanelModel {
  slot: "parent" | "flagship" | "budget" | "refill" | "explicit";
  entry: string;
  kind: string;
  resolvedModelId: string;
  harness: HarnessKind;
  modelPreference: ModelPreference;
  validatedBy: string;
  fallbackUsed?: boolean;
}

export interface ResolvedPanelComposition {
  panelSpec: PanelSpec;
  harnessSelectionPolicy: HarnessSelectionPolicy;
  resolvedModels: ResolvedPanelModel[];
  warnings: string[];
  opencodeModels: string[];
  cursorModels: string[];
}

export interface ResolveModelEntryOptions {
  opencodeCommand?: string;
  cursorCommand?: string;
  executor?: CommandExecutor;
  cwd?: string;
  opencodeModels?: string[];
  cursorModels?: string[];
}

interface ModelSource {
  slot: ResolvedPanelModel["slot"];
  entry: string;
  kind: string;
  candidateIds: string[];
  forcedHarness?: HarnessKind;
}

interface RoutedCandidate {
  modelId: string;
  harness: HarnessKind;
}

export async function resolvePanelComposition(
  options: ResolvePanelCompositionOptions = {},
): Promise<ResolvedPanelComposition> {
  const panelists = options.panelists ?? DEFAULT_PANEL_SIZE;
  if (!Number.isInteger(panelists) || panelists < 1) {
    throw new RangeError("--panelists must be a positive integer.");
  }

  const warnings: string[] = [];
  const opencodeModels = new LazyOpenCodeModels(options);
  const cursorModels = new LazyCursorModels(options);
  const explicitModels = options.models?.filter((entry) => entry.length > 0);
  const resolvedModels =
    explicitModels !== undefined
      ? await resolveExplicitModels(
          explicitModels,
          panelists,
          options,
          opencodeModels,
          cursorModels,
        )
      : await resolveDefaultModels(
          panelists,
          options.parentModel,
          warnings,
          opencodeModels,
          cursorModels,
        );

  return {
    panelSpec: {
      workerCount: resolvedModels.length,
      workers: resolvedModels.map((model) => ({
        model: model.modelPreference,
        harness: { kind: model.harness, invocation: "headless" },
      })),
      parentModel:
        options.parentModel === undefined
          ? undefined
          : modelPreferenceForReportedEntry(options.parentModel),
    },
    harnessSelectionPolicy: {
      availableHarnesses: unique(resolvedModels.map((model) => model.harness)),
    },
    resolvedModels,
    warnings,
    opencodeModels: opencodeModels.snapshot(),
    cursorModels: cursorModels.snapshot(),
  };
}

export async function resolveModelEntry(
  entry: string,
  options: ResolveModelEntryOptions = {},
): Promise<ResolvedPanelModel> {
  const opencodeModels = new LazyOpenCodeModels(options);
  const cursorModels = new LazyCursorModels(options);
  const model = await tryResolveSource(
    sourceFromEntry("explicit", entry),
    new Set(),
    opencodeModels,
    cursorModels,
    { allowDuplicate: true, required: true },
  );
  if (model === undefined) {
    throw new Error(`Unable to resolve Fusion model entry: ${entry}`);
  }
  return model;
}

async function resolveExplicitModels(
  entries: string[],
  panelists: number,
  options: ResolvePanelCompositionOptions,
  opencodeModels: LazyOpenCodeModels,
  cursorModels: LazyCursorModels,
): Promise<ResolvedPanelModel[]> {
  if (options.panelistsExplicit === true && entries.length !== panelists) {
    throw new RangeError(
      `--models provides ${entries.length} model entries but --panelists requested ${panelists}.`,
    );
  }

  const resolved: ResolvedPanelModel[] = [];
  for (const entry of entries) {
    const model = await tryResolveSource(
      sourceFromEntry("explicit", entry),
      new Set(),
      opencodeModels,
      cursorModels,
      { allowDuplicate: true, required: true },
    );
    if (model === undefined) {
      throw new Error(`Unable to resolve Fusion model entry: ${entry}`);
    }
    resolved.push(model);
  }
  return resolved;
}

async function resolveDefaultModels(
  panelists: number,
  parentModel: string | undefined,
  warnings: string[],
  opencodeModels: LazyOpenCodeModels,
  cursorModels: LazyCursorModels,
): Promise<ResolvedPanelModel[]> {
  const sources: ModelSource[] = [];
  if (parentModel === undefined) {
    warnings.push(
      "No --parent-model was provided; the parent-model slot was omitted and refilled from alias fallbacks.",
    );
  } else {
    sources.push(sourceFromEntry("parent", parentModel));
  }
  sources.push(sourceFromEntry("flagship", "openai-flagship"));
  sources.push(sourceFromEntry("budget", "budget-smart"));

  const used = new Set<string>();
  const resolved: ResolvedPanelModel[] = [];
  for (const source of sources) {
    const model = await tryResolveSource(
      source,
      used,
      opencodeModels,
      cursorModels,
    );
    if (model === undefined) {
      warnings.push(
        `Default ${source.slot} slot (${source.entry}) was unavailable or duplicated and was refilled.`,
      );
      continue;
    }
    if (model.fallbackUsed === true) {
      warnings.push(
        `Default ${source.slot} slot (${source.entry}) used fallback model ${model.resolvedModelId}.`,
      );
    }
    resolved.push(model);
    used.add(model.resolvedModelId);
  }

  const refillCandidates = [
    ...candidateIdsForAlias("openai-flagship"),
    ...candidateIdsForAlias("budget-smart"),
  ];
  while (resolved.length < panelists) {
    const refill = await tryResolveSource(
      {
        slot: "refill",
        entry: "alias-fallback",
        kind: "fusion-alias",
        candidateIds: refillCandidates,
      },
      used,
      opencodeModels,
      cursorModels,
    );
    if (refill === undefined) {
      throw new Error(
        `Unable to resolve ${panelists} distinct Fusion models from the default fallback lists.`,
      );
    }
    resolved.push(refill);
    used.add(refill.resolvedModelId);
  }

  return resolved.slice(0, panelists);
}

async function tryResolveSource(
  source: ModelSource,
  used: Set<string>,
  opencodeModels: LazyOpenCodeModels,
  cursorModels: LazyCursorModels,
  options: { allowDuplicate?: boolean; required?: boolean } = {},
): Promise<ResolvedPanelModel | undefined> {
  for (const [index, candidateId] of source.candidateIds.entries()) {
    const routed = routeModelEntry(candidateId, source.forcedHarness);
    if (options.allowDuplicate !== true && used.has(routed.modelId)) {
      continue;
    }
    if (
      routed.harness === "opencode" &&
      !(await opencodeModels.includes(routed.modelId))
    ) {
      if (options.required === true && source.candidateIds.length === 1) {
        throw new Error(
          `OpenCode model is not available according to opencode models: ${routed.modelId}`,
        );
      }
      continue;
    }
    if (
      routed.harness === "cursor" &&
      !(await cursorModels.includes(routed.modelId))
    ) {
      if (options.required === true && source.candidateIds.length === 1) {
        throw new Error(
          `Cursor model is not available according to cursor-agent models: ${routed.modelId}`,
        );
      }
      continue;
    }

    const fallbackIds = source.candidateIds.slice(index + 1);
    return {
      slot: source.slot,
      entry: source.entry,
      kind: source.kind,
      resolvedModelId: routed.modelId,
      harness: routed.harness,
      modelPreference: modelPreferenceFromModelId(routed.modelId, fallbackIds),
      validatedBy: validatedByForHarness(routed.harness),
      fallbackUsed: index > 0,
    };
  }
  return undefined;
}

function sourceFromEntry(
  slot: ResolvedPanelModel["slot"],
  entry: string,
): ModelSource {
  const normalized = entry.trim();
  if (normalized.length === 0) {
    throw new Error("Fusion model entries must not be empty.");
  }

  const prefix = forcedPrefix(normalized);
  const unprefixed = prefix?.entry ?? normalized;
  if (modelAliasTable[unprefixed] !== undefined) {
    if (prefix?.harness === "cursor") {
      throw new Error(
        `Cursor model entries must use a concrete cursor model id, not an alias: ${normalized}`,
      );
    }
    return {
      slot,
      entry: normalized,
      kind: "fusion-alias",
      candidateIds: candidateIdsForAlias(unprefixed),
      forcedHarness: prefix?.harness,
    };
  }

  const routed = routeModelEntry(unprefixed, prefix?.harness);
  return {
    slot,
    entry: normalized,
    kind: kindForRoutedEntry(unprefixed, routed.harness),
    candidateIds: [routed.modelId],
    forcedHarness: prefix?.harness,
  };
}

function kindForRoutedEntry(entry: string, harness: HarnessKind): string {
  if (harness === "cursor") {
    return "routing-product";
  }
  if (isClaudeTierAlias(entry)) {
    return "tier-alias";
  }
  return "catalog-id";
}

function validatedByForHarness(harness: HarnessKind): string {
  return harness === "opencode" || harness === "cursor"
    ? "harness-list"
    : "pattern";
}

function candidateIdsForAlias(alias: string): string[] {
  const preference = modelAliasTable[alias];
  if (preference === undefined) {
    throw new Error(`Unknown Fusion model alias: ${alias}`);
  }

  const primary = modelIdFromPreference(preference);
  return [primary, ...(preference.fallbacks ?? [])];
}

function routeModelEntry(
  entry: string,
  forcedHarness?: HarnessKind,
): RoutedCandidate {
  if (forcedHarness !== undefined) {
    return routeWithForcedHarness(entry, forcedHarness);
  }
  if (isClaudeModelId(entry)) {
    return { modelId: entry, harness: "claude-code" };
  }
  if (isProviderQualifiedModel(entry)) {
    return { modelId: entry, harness: "opencode" };
  }
  throw new Error(`Unrecognized Fusion model entry: ${entry}`);
}

function routeWithForcedHarness(
  entry: string,
  harness: HarnessKind,
): RoutedCandidate {
  if (harness === "opencode") {
    if (!isProviderQualifiedModel(entry)) {
      throw new Error(
        `OpenCode model entries must be provider-qualified: ${entry}`,
      );
    }
    return { modelId: entry, harness };
  }
  if (harness === "claude-code") {
    if (!isClaudeModelId(entry)) {
      throw new Error(
        `Claude Code model entry is not a Claude alias or id: ${entry}`,
      );
    }
    return { modelId: entry, harness };
  }
  if (harness === "cursor") {
    return { modelId: entry, harness };
  }
  throw new Error(`Unsupported Fusion harness prefix: ${harness}`);
}

function forcedPrefix(
  entry: string,
): { harness: HarnessKind; entry: string } | undefined {
  const match = /^(opencode|claude-code|cursor):(.+)$/u.exec(entry);
  if (match === null) {
    return undefined;
  }
  return { harness: match[1] as HarnessKind, entry: match[2].trim() };
}

function modelPreferenceForReportedEntry(entry: string): ModelPreference {
  return modelPreferenceFromModelId(
    sourceFromEntry("parent", entry).candidateIds[0] ?? entry,
  );
}

function modelPreferenceFromModelId(
  modelId: string,
  fallbacks: string[] = [],
): ModelPreference {
  const effectiveFallbacks =
    fallbacks.length > 0 ? fallbacks : claudeFallbacksForModelId(modelId);
  const slashIndex = modelId.indexOf("/");
  if (slashIndex > 0) {
    return {
      provider: modelId.slice(0, slashIndex),
      model: modelId.slice(slashIndex + 1),
      fallbacks: effectiveFallbacks,
    };
  }
  return { model: modelId, fallbacks: effectiveFallbacks };
}

function modelIdFromPreference(preference: ModelPreference): string {
  const modelId = modelPreferenceToModel(preference);
  if (modelId === undefined) {
    throw new Error("ModelPreference must include a model or alias.");
  }
  return modelId;
}

function isProviderQualifiedModel(entry: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.:@+-]+$/u.test(entry);
}

const claudeModelIdPattern = new RegExp(
  `^(?:${claudeModelAliases.join("|")}|claude-[A-Za-z0-9_.:-]+)$`,
  "iu",
);

function isClaudeModelId(entry: string): boolean {
  return claudeModelIdPattern.test(entry);
}

function isClaudeTierAlias(entry: string): boolean {
  return claudeModelAliases.includes(entry.toLowerCase());
}

function claudeFallbacksForModelId(modelId: string): string[] {
  switch (modelId.toLowerCase()) {
    case "fable":
    case "opus":
      return ["sonnet", "haiku"];
    case "sonnet":
      return ["haiku"];
    case "haiku":
      return [];
    default:
      return modelId.toLowerCase().startsWith("claude-")
        ? ["sonnet", "haiku"]
        : [];
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

class LazyOpenCodeModels {
  private loadedModels: string[] | undefined;

  constructor(
    private readonly options:
      ResolvePanelCompositionOptions | ResolveModelEntryOptions,
  ) {
    this.loadedModels = options.opencodeModels;
  }

  async includes(modelId: string): Promise<boolean> {
    const models = await this.load();
    return models.includes(modelId);
  }

  snapshot(): string[] {
    return this.loadedModels ?? [];
  }

  private async load(): Promise<string[]> {
    if (this.loadedModels !== undefined) {
      return this.loadedModels;
    }

    const executor = this.options.executor ?? executeCommand;
    const result = await executor({
      command: this.options.opencodeCommand ?? "opencode",
      args: ["models"],
      cwd: this.options.cwd,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `opencode models failed with code ${result.exitCode}: ${snippet(result.stderr || result.stdout)}`,
      );
    }
    this.loadedModels = parseOpenCodeModels(result.stdout);
    if (this.loadedModels.length === 0) {
      throw new Error("opencode models returned no provider-qualified models.");
    }
    return this.loadedModels;
  }
}

class LazyCursorModels {
  private loadedModels: string[] | undefined;

  constructor(
    private readonly options:
      ResolvePanelCompositionOptions | ResolveModelEntryOptions,
  ) {
    this.loadedModels = options.cursorModels;
  }

  async includes(modelId: string): Promise<boolean> {
    const models = await this.load();
    return models.includes(modelId);
  }

  snapshot(): string[] {
    return this.loadedModels ?? [];
  }

  private async load(): Promise<string[]> {
    if (this.loadedModels !== undefined) {
      return this.loadedModels;
    }

    const executor = this.options.executor ?? executeCommand;
    const result = await executor({
      command: this.options.cursorCommand ?? "cursor-agent",
      args: ["models"],
      cwd: this.options.cwd,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `cursor-agent models failed with code ${result.exitCode}: ${snippet(result.stderr || result.stdout)}`,
      );
    }
    this.loadedModels = parseCursorModels(result.stdout);
    if (this.loadedModels.length === 0) {
      throw new Error("cursor-agent models returned no model ids.");
    }
    return this.loadedModels;
  }
}

function parseOpenCodeModels(stdout: string): string[] {
  return unique(
    stdout
      .split(/\r?\n/u)
      .map((line) => stripAnsi(line).trim())
      .filter(isProviderQualifiedModel),
  );
}

export function parseCursorModels(stdout: string): string[] {
  return unique(
    stdout
      .split(/\r?\n/u)
      .map((line) => stripAnsi(line).trim())
      .flatMap((line) => {
        const match = /^(\S+)\s+-\s+.+$/u.exec(line);
        return match === null ? [] : [match[1]];
      }),
  );
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/gu, "");
}
