import { errorMessage } from "./errors";
import type {
  JudgeAnalysis,
  JudgeAnnotatedFinding,
  JudgeAttribution,
  JudgeAttributedStance,
  JudgeContradiction,
  JudgeFinding,
  JudgeQuote,
  JudgeStance,
  JudgeStances,
  WorkerResult,
} from "./types";

const judgeCoreKeys = [
  "consensus",
  "contradictions",
  "partial_coverage",
  "unique_insights",
  "blind_spots",
] as const;

type JudgeCoreKey = (typeof judgeCoreKeys)[number];
type JudgeFindingKey = Exclude<JudgeCoreKey, "contradictions">;

const judgeFindingSections: Array<{
  key: JudgeFindingKey;
  heading: string;
}> = [
  { key: "consensus", heading: "Consensus" },
  { key: "partial_coverage", heading: "Partial Coverage" },
  { key: "unique_insights", heading: "Unique Insights" },
  { key: "blind_spots", heading: "Blind Spots" },
];

export class JudgeAnalysisValidationError extends Error {}

export interface JudgeAnalysisParseResult {
  analysis: JudgeAnalysis;
  warnings: string[];
}

export function parseJudgeAnalysisOutput(
  output: string,
  workerResults: WorkerResult[],
): JudgeAnalysisParseResult {
  const jsonText = extractJsonObjectText(stripCodeFence(output));
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new JudgeAnalysisValidationError(
      `Judge output was not valid JSON: ${errorMessage(error)}`,
    );
  }

  const warnings: string[] = [];
  const analysis = validateJudgeAnalysis(parsed, warnings, workerResults);
  warnings.push(...verifyJudgeQuotes(analysis, workerResults));
  return { analysis, warnings };
}

export function validateJudgeAnalysis(
  value: unknown,
  warnings: string[] = [],
  workerResults: WorkerResult[] = [],
): JudgeAnalysis {
  const record = expectRecord(value, "analysis");
  const modelCandidates = workerModelCandidates(workerResults);
  const keys = Object.keys(record);
  const unexpectedKeys = keys.filter(
    (key) => !judgeCoreKeys.includes(key as JudgeCoreKey),
  );
  const missingKeys = judgeCoreKeys.filter((key) => !(key in record));
  if (missingKeys.length > 0 || unexpectedKeys.length > 0) {
    throw new JudgeAnalysisValidationError(
      [
        missingKeys.length === 0
          ? undefined
          : `missing keys: ${missingKeys.join(", ")}`,
        unexpectedKeys.length === 0
          ? undefined
          : `unexpected keys: ${unexpectedKeys.join(", ")}`,
      ]
        .filter((entry): entry is string => entry !== undefined)
        .join("; "),
    );
  }

  const findings = Object.fromEntries(
    judgeFindingSections.map(({ key }) => [
      key,
      normalizeFindingArray(record[key], key, warnings, modelCandidates, key),
    ]),
  ) as Pick<JudgeAnalysis, JudgeFindingKey>;
  return {
    consensus: findings.consensus,
    contradictions: normalizeContradictions(
      record.contradictions,
      "contradictions",
      warnings,
      modelCandidates,
    ),
    partial_coverage: findings.partial_coverage,
    unique_insights: findings.unique_insights,
    blind_spots: findings.blind_spots,
  };
}

export function renderJudgeAnalysisMarkdown(analysis: JudgeAnalysis): string {
  return [
    "# Fusion Judge Analysis",
    "",
    ...renderFindingSections(analysis, ["consensus"]),
    "",
    "## Contradictions",
    renderContradictions(analysis.contradictions),
    "",
    ...renderFindingSections(analysis, [
      "partial_coverage",
      "unique_insights",
      "blind_spots",
    ]),
  ].join("\n");
}

function stripCodeFence(output: string): string {
  const trimmed = output.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

function extractJsonObjectText(output: string): string {
  const firstBrace = output.indexOf("{");
  if (firstBrace === -1) {
    throw new JudgeAnalysisValidationError(
      "Judge output did not contain a JSON object.",
    );
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = firstBrace; index < output.length; index += 1) {
    const char = output[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return output.slice(firstBrace, index + 1);
      }
    }
  }

  throw new JudgeAnalysisValidationError(
    "Judge output contained an unterminated JSON object.",
  );
}

function normalizeFindingArray(
  value: unknown,
  path: string,
  warnings: string[],
  modelCandidates: WorkerModelCandidate[],
  sectionKey: JudgeFindingKey,
): JudgeFinding[] {
  if (!Array.isArray(value)) {
    throw new JudgeAnalysisValidationError(`${path} must be an array.`);
  }
  return value.map((item, index) =>
    normalizeFinding(
      item,
      `${path}[${index}]`,
      warnings,
      modelCandidates,
      sectionKey,
    ),
  );
}

function normalizeFinding(
  value: unknown,
  path: string,
  warnings: string[],
  modelCandidates: WorkerModelCandidate[],
  sectionKey: JudgeFindingKey,
): JudgeFinding {
  if (typeof value === "string") {
    return value;
  }
  const record = expectRecord(value, path);
  if (typeof record.text === "string") {
    const finding: JudgeAnnotatedFinding = { text: record.text };
    const attribution = optionalAttribution(record.attribution, path, warnings);
    if (attribution !== undefined) {
      finding.attribution = attribution;
    }
    const quotes = optionalQuotes(record.quotes, path, warnings);
    if (quotes !== undefined) {
      finding.quotes = quotes;
    }
    return finding;
  }

  if (
    sectionKey === "partial_coverage" &&
    hasExactKeys(record, ["models", "point"])
  ) {
    return normalizeUpstreamPartialCoverageFinding(
      record,
      path,
      warnings,
      modelCandidates,
    );
  }

  if (
    sectionKey === "unique_insights" &&
    hasExactKeys(record, ["model", "insight"])
  ) {
    return normalizeUpstreamUniqueInsightFinding(
      record,
      path,
      warnings,
      modelCandidates,
    );
  }

  throw new JudgeAnalysisValidationError(
    `${path} must be a string or an object with text.`,
  );
}

function normalizeUpstreamPartialCoverageFinding(
  record: Record<string, unknown>,
  path: string,
  warnings: string[],
  modelCandidates: WorkerModelCandidate[],
): JudgeFinding {
  const models = expectStringArray(record.models, `${path}.models`);
  if (typeof record.point !== "string") {
    throw new JudgeAnalysisValidationError(`${path}.point must be a string.`);
  }

  const finding: JudgeAnnotatedFinding = { text: record.point };
  const attribution = resolveModelAttributions(
    models,
    `${path}.models`,
    warnings,
    modelCandidates,
  );
  if (attribution !== undefined) {
    finding.attribution = attribution;
  }
  return finding;
}

function normalizeUpstreamUniqueInsightFinding(
  record: Record<string, unknown>,
  path: string,
  warnings: string[],
  modelCandidates: WorkerModelCandidate[],
): JudgeFinding {
  if (typeof record.model !== "string") {
    throw new JudgeAnalysisValidationError(`${path}.model must be a string.`);
  }
  if (typeof record.insight !== "string") {
    throw new JudgeAnalysisValidationError(`${path}.insight must be a string.`);
  }

  const finding: JudgeAnnotatedFinding = { text: record.insight };
  const attribution = resolveModelAttribution(
    record.model,
    `${path}.model`,
    warnings,
    modelCandidates,
  );
  if (attribution !== undefined) {
    finding.attribution = [attribution];
  }
  return finding;
}

function normalizeContradictions(
  value: unknown,
  path: string,
  warnings: string[],
  modelCandidates: WorkerModelCandidate[],
): JudgeContradiction[] {
  if (!Array.isArray(value)) {
    throw new JudgeAnalysisValidationError(`${path} must be an array.`);
  }
  return value.map((item, index) =>
    normalizeContradiction(
      item,
      `${path}[${index}]`,
      warnings,
      modelCandidates,
    ),
  );
}

function normalizeContradiction(
  value: unknown,
  path: string,
  warnings: string[],
  modelCandidates: WorkerModelCandidate[],
): JudgeContradiction {
  const record = expectRecord(value, path);
  if (typeof record.topic !== "string") {
    throw new JudgeAnalysisValidationError(`${path}.topic must be a string.`);
  }
  const contradiction: JudgeContradiction = {
    topic: record.topic,
    stances: normalizeStances(
      record.stances,
      `${path}.stances`,
      warnings,
      modelCandidates,
    ),
  };

  const attribution = optionalAttribution(record.attribution, path, warnings);
  if (attribution !== undefined) {
    contradiction.attribution = attribution;
  }
  const quotes = optionalQuotes(record.quotes, path, warnings);
  if (quotes !== undefined) {
    contradiction.quotes = quotes;
  }
  return contradiction;
}

function normalizeStances(
  value: unknown,
  path: string,
  warnings: string[],
  modelCandidates: WorkerModelCandidate[],
): JudgeStances {
  if (Array.isArray(value)) {
    return value.map((stance, index) =>
      normalizeStance(stance, `${path}[${index}]`, warnings, modelCandidates),
    );
  }

  const record = expectRecord(value, path);
  const normalized: Record<string, string> = {};
  for (const [key, stance] of Object.entries(record)) {
    if (typeof stance !== "string") {
      throw new JudgeAnalysisValidationError(
        `${path}.${key} must be a string.`,
      );
    }
    normalized[key] = stance;
  }
  return normalized;
}

function normalizeStance(
  value: unknown,
  path: string,
  warnings: string[],
  modelCandidates: WorkerModelCandidate[],
): JudgeStance {
  if (typeof value === "string") {
    return value;
  }

  const record = expectRecord(value, path);
  if (typeof record.stance !== "string") {
    throw new JudgeAnalysisValidationError(
      `${path} must be a string or an object with stance.`,
    );
  }

  const stance: JudgeAttributedStance = { stance: record.stance };
  if (typeof record.workerId === "string") {
    stance.workerId = record.workerId;
  }
  if (typeof record.modelUsed === "string") {
    stance.modelUsed = record.modelUsed;
  }
  const attribution = optionalAttribution(record.attribution, path, warnings);
  if (attribution !== undefined) {
    stance.attribution = attribution;
  } else if (
    typeof record.workerId !== "string" &&
    typeof record.model === "string"
  ) {
    const modelAttribution = resolveModelAttribution(
      record.model,
      `${path}.model`,
      warnings,
      modelCandidates,
    );
    if (modelAttribution !== undefined) {
      stance.attribution = [modelAttribution];
    }
  }
  const quotes = optionalQuotes(record.quotes, path, warnings);
  if (quotes !== undefined) {
    stance.quotes = quotes;
  }
  return stance;
}

interface WorkerModelCandidate {
  workerId: string;
  modelUsed: string;
  normalizedModel: string;
  normalizedBareModel: string;
}

function resolveModelAttributions(
  modelNames: string[],
  path: string,
  warnings: string[],
  candidates: WorkerModelCandidate[],
): JudgeAttribution[] | undefined {
  const attribution = modelNames
    .map((modelName, index) =>
      resolveModelAttribution(
        modelName,
        `${path}[${index}]`,
        warnings,
        candidates,
      ),
    )
    .filter((item): item is JudgeAttribution => item !== undefined);
  const uniqueAttribution = uniqueJudgeAttributions(attribution);
  return uniqueAttribution.length === 0 ? undefined : uniqueAttribution;
}

function resolveModelAttribution(
  modelName: string,
  path: string,
  warnings: string[],
  candidates: WorkerModelCandidate[],
): JudgeAttribution | undefined {
  const normalizedModel = normalizeModelName(modelName);
  const normalizedBareModel = bareModelName(normalizedModel);
  const matchGroups = [
    candidates.filter((candidate) => candidate.modelUsed === modelName),
    candidates.filter(
      (candidate) => candidate.normalizedModel === normalizedModel,
    ),
    normalizedBareModel.length === 0
      ? []
      : candidates.filter(
          (candidate) =>
            candidate.normalizedBareModel === normalizedBareModel,
        ),
  ];

  for (const matches of matchGroups) {
    if (matches.length === 1) {
      return candidateAttribution(matches[0]);
    }
    if (matches.length > 1) {
      warnings.push(
        `${path} was ignored because model "${modelName}" matched multiple workers: ${matches
          .map((match) => match.workerId)
          .join(", ")}.`,
      );
      return undefined;
    }
  }

  warnings.push(
    `${path} was ignored because model "${modelName}" did not match any worker modelUsed value.`,
  );
  return undefined;
}

function workerModelCandidates(
  workerResults: WorkerResult[],
): WorkerModelCandidate[] {
  return workerResults
    .flatMap((worker) => {
      if (typeof worker.modelUsed !== "string") {
        return [];
      }
      const normalizedModel = normalizeModelName(worker.modelUsed);
      if (normalizedModel.length === 0) {
        return [];
      }
      return {
        workerId: worker.workerId,
        modelUsed: worker.modelUsed,
        normalizedModel,
        normalizedBareModel: bareModelName(normalizedModel),
      };
    });
}

function candidateAttribution(
  candidate: WorkerModelCandidate,
): JudgeAttribution {
  return {
    workerId: candidate.workerId,
    modelUsed: candidate.modelUsed,
  };
}

function uniqueJudgeAttributions(
  attribution: JudgeAttribution[],
): JudgeAttribution[] {
  const seen = new Set<string>();
  return attribution.filter((item) => {
    const key = `${item.workerId}\0${item.modelUsed ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeModelName(modelName: string): string {
  return modelName.trim().toLowerCase();
}

function bareModelName(normalizedModelName: string): string {
  const separatorIndex = normalizedModelName.lastIndexOf("/");
  return separatorIndex === -1
    ? normalizedModelName
    : normalizedModelName.slice(separatorIndex + 1);
}

function expectStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new JudgeAnalysisValidationError(
      `${path} must be an array of strings.`,
    );
  }
  return value;
}

function hasExactKeys(
  record: Record<string, unknown>,
  expectedKeys: string[],
): boolean {
  const keys = Object.keys(record);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => key in record)
  );
}

function optionalAttribution(
  value: unknown,
  path: string,
  warnings: string[],
): JudgeAttribution[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    warnings.push(`${path}.attribution was ignored because it is not an array.`);
    return undefined;
  }

  const attribution = value
    .map((item, index) =>
      normalizeAttribution(item, `${path}.attribution[${index}]`, warnings),
    )
    .filter((item): item is JudgeAttribution => item !== undefined);
  return attribution.length === 0 ? undefined : attribution;
}

function normalizeAttribution(
  value: unknown,
  path: string,
  warnings: string[],
): JudgeAttribution | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    warnings.push(`${path} was ignored because it is not an object.`);
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.workerId !== "string") {
    warnings.push(`${path} was ignored because workerId is missing.`);
    return undefined;
  }
  return {
    workerId: record.workerId,
    ...(typeof record.modelUsed === "string"
      ? { modelUsed: record.modelUsed }
      : {}),
  };
}

function optionalQuotes(
  value: unknown,
  path: string,
  warnings: string[],
): JudgeQuote[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    warnings.push(`${path}.quotes was ignored because it is not an array.`);
    return undefined;
  }

  const quotes = value
    .map((item, index) =>
      normalizeQuote(item, `${path}.quotes[${index}]`, warnings),
    )
    .filter((item): item is JudgeQuote => item !== undefined);
  return quotes.length === 0 ? undefined : quotes;
}

function normalizeQuote(
  value: unknown,
  path: string,
  warnings: string[],
): JudgeQuote | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    warnings.push(`${path} was ignored because it is not an object.`);
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.workerId !== "string" || typeof record.quote !== "string") {
    warnings.push(`${path} was ignored because workerId or quote is missing.`);
    return undefined;
  }
  return {
    workerId: record.workerId,
    quote: record.quote,
  };
}

function verifyJudgeQuotes(
  analysis: JudgeAnalysis,
  workerResults: WorkerResult[],
): string[] {
  const warnings: string[] = [];
  const workerOutputById = new Map(
    workerResults.map((worker) => [worker.workerId, worker.output]),
  );
  for (const quote of collectQuotes(analysis)) {
    const output = workerOutputById.get(quote.quote.workerId);
    if (output === undefined) {
      warnings.push(
        `Judge quote at ${quote.path} references unknown worker ${quote.quote.workerId}.`,
      );
      continue;
    }
    if (!output.includes(quote.quote.quote)) {
      warnings.push(
        `Judge quote at ${quote.path} was not found in ${quote.quote.workerId} output.`,
      );
    }
  }
  return warnings;
}

function collectQuotes(
  analysis: JudgeAnalysis,
): Array<{ path: string; quote: JudgeQuote }> {
  return [
    ...collectSectionFindingQuotes(analysis, ["consensus"]),
    ...collectContradictionQuotes(analysis.contradictions, "contradictions"),
    ...collectSectionFindingQuotes(analysis, [
      "partial_coverage",
      "unique_insights",
      "blind_spots",
    ]),
  ];
}

function collectSectionFindingQuotes(
  analysis: JudgeAnalysis,
  keys: JudgeFindingKey[],
): Array<{ path: string; quote: JudgeQuote }> {
  return judgeFindingSections
    .filter(({ key }) => keys.includes(key))
    .flatMap(({ key }) => collectFindingQuotes(analysis[key], key));
}

function collectFindingQuotes(
  findings: JudgeFinding[],
  path: string,
): Array<{ path: string; quote: JudgeQuote }> {
  return findings.flatMap((finding, index) =>
    typeof finding === "string"
      ? []
      : collectQuoteArray(finding.quotes, `${path}[${index}].quotes`),
  );
}

function collectContradictionQuotes(
  contradictions: JudgeContradiction[],
  path: string,
): Array<{ path: string; quote: JudgeQuote }> {
  return contradictions.flatMap((contradiction, index) => [
    ...collectQuoteArray(contradiction.quotes, `${path}[${index}].quotes`),
    ...(Array.isArray(contradiction.stances)
      ? contradiction.stances.flatMap((stance, stanceIndex) =>
          typeof stance === "string"
            ? []
            : collectQuoteArray(
                stance.quotes,
                `${path}[${index}].stances[${stanceIndex}].quotes`,
              ),
        )
      : []),
  ]);
}

function collectQuoteArray(
  quotes: JudgeQuote[] | undefined,
  path: string,
): Array<{ path: string; quote: JudgeQuote }> {
  return (quotes ?? []).map((quote, index) => ({
    path: `${path}[${index}]`,
    quote,
  }));
}

function renderFindingSection(findings: JudgeFinding[]): string {
  if (findings.length === 0) {
    return "None.";
  }
  return findings.map((finding) => `- ${findingText(finding)}`).join("\n");
}

function renderFindingSections(
  analysis: JudgeAnalysis,
  keys: JudgeFindingKey[],
): string[] {
  const sections = judgeFindingSections
    .filter(({ key }) => keys.includes(key))
    .map(({ key, heading }) => [
      `## ${heading}`,
      renderFindingSection(analysis[key]),
    ]);
  return sections.flatMap((section, index) =>
    index === sections.length - 1 ? section : [...section, ""],
  );
}

function renderContradictions(contradictions: JudgeContradiction[]): string {
  if (contradictions.length === 0) {
    return "None.";
  }
  return contradictions.map(renderContradiction).join("\n");
}

function renderContradiction(contradiction: JudgeContradiction): string {
  const stanceLines = Array.isArray(contradiction.stances)
    ? contradiction.stances.map((stance) => `  - ${stanceText(stance)}`)
    : Object.entries(contradiction.stances).map(
        ([source, stance]) => `  - ${source}: ${stance}`,
      );
  return [`- ${contradiction.topic}`, ...stanceLines].join("\n");
}

function findingText(finding: JudgeFinding): string {
  if (typeof finding === "string") {
    return finding;
  }
  return `${finding.text}${attributionSuffix(finding.attribution)}`;
}

function stanceText(stance: JudgeStance): string {
  if (typeof stance === "string") {
    return stance;
  }
  const source = stance.workerId ?? stance.modelUsed;
  return `${source === undefined ? "" : `${source}: `}${stance.stance}`;
}

function attributionSuffix(
  attribution: JudgeAttribution[] | undefined,
): string {
  if (attribution === undefined || attribution.length === 0) {
    return "";
  }
  return ` (${attribution
    .map((item) => item.modelUsed ?? item.workerId)
    .join(", ")})`;
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new JudgeAnalysisValidationError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}
