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
  const analysis = validateJudgeAnalysis(parsed, warnings);
  warnings.push(...verifyJudgeQuotes(analysis, workerResults));
  return { analysis, warnings };
}

export function validateJudgeAnalysis(
  value: unknown,
  warnings: string[] = [],
): JudgeAnalysis {
  const record = expectRecord(value, "analysis");
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
      normalizeFindingArray(record[key], key, warnings),
    ]),
  ) as Pick<JudgeAnalysis, JudgeFindingKey>;
  return {
    consensus: findings.consensus,
    contradictions: normalizeContradictions(
      record.contradictions,
      "contradictions",
      warnings,
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
): JudgeFinding[] {
  if (!Array.isArray(value)) {
    throw new JudgeAnalysisValidationError(`${path} must be an array.`);
  }
  return value.map((item, index) =>
    normalizeFinding(item, `${path}[${index}]`, warnings),
  );
}

function normalizeFinding(
  value: unknown,
  path: string,
  warnings: string[],
): JudgeFinding {
  if (typeof value === "string") {
    return value;
  }
  const record = expectRecord(value, path);
  if (typeof record.text !== "string") {
    throw new JudgeAnalysisValidationError(
      `${path} must be a string or an object with text.`,
    );
  }

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

function normalizeContradictions(
  value: unknown,
  path: string,
  warnings: string[],
): JudgeContradiction[] {
  if (!Array.isArray(value)) {
    throw new JudgeAnalysisValidationError(`${path} must be an array.`);
  }
  return value.map((item, index) =>
    normalizeContradiction(item, `${path}[${index}]`, warnings),
  );
}

function normalizeContradiction(
  value: unknown,
  path: string,
  warnings: string[],
): JudgeContradiction {
  const record = expectRecord(value, path);
  if (typeof record.topic !== "string") {
    throw new JudgeAnalysisValidationError(`${path}.topic must be a string.`);
  }
  const contradiction: JudgeContradiction = {
    topic: record.topic,
    stances: normalizeStances(record.stances, `${path}.stances`, warnings),
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
): JudgeStances {
  if (Array.isArray(value)) {
    return value.map((stance, index) =>
      normalizeStance(stance, `${path}[${index}]`, warnings),
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
  }
  const quotes = optionalQuotes(record.quotes, path, warnings);
  if (quotes !== undefined) {
    stance.quotes = quotes;
  }
  return stance;
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
