import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, join, resolve } from "node:path";
import type { JudgePromptExtras } from "./judge-synthesizer";
import type {
  HarnessKind,
  ModelPreference,
  PanelRequest,
  SynthesisInput,
  SynthesisResult,
  ToolsPolicy,
  WorkerRequest,
  WorkerResult,
} from "./types";

const recordedArtifactNames = [
  "request.json",
  "worker-requests.json",
  "worker-results.json",
  "synthesis.json",
] as const;

export interface RecordedJudgeRun {
  runDir: string;
  panelRequest: PanelRequest;
  workerRequests: WorkerRequest[];
  workerResults: WorkerResult[];
  synthesis: SynthesisResult;
}

export interface JudgeReplayArmConfig {
  judgeModel: ModelPreference;
  judgeHarness: HarnessKind;
  toolsMode: "none" | "worker-parity";
  groundingAppendix?: string;
  timeoutMs?: number;
}

export interface BuiltJudgeReplayInput {
  synthesisInput: SynthesisInput;
  judgeToolsPolicy?: ToolsPolicy;
  judgePromptExtras?: JudgePromptExtras;
}

export interface ReplayManifestInput {
  armId: string;
  judgeModelEntry: string;
  judgeHarness: HarnessKind;
  toolsPolicyMode: "none" | "worker-parity";
  toolsConstraintPresent: boolean;
  groundingPresent: boolean;
  groundingAppendix?: string;
  timeoutMs: number;
  timestamp?: string;
  force?: boolean;
}

export interface ReplayManifest {
  armId: string;
  judge: { modelEntry: string; harness: HarnessKind };
  toolsPolicyMode: "none" | "worker-parity";
  promptSections: {
    toolsConstraint: boolean;
    grounding: boolean;
    groundingAppendixSha256?: string;
  };
  timeoutMs: number;
  timestamp: string;
  inputProvenance: {
    workerRequestsSha256: string;
    workerResultsSha256: string;
  };
}

export interface ReplayArtifactPaths {
  synthesis: string;
  manifest: string;
}

export async function assertReplayArtifactsAvailable(
  runDir: string,
  armId: string,
): Promise<void> {
  assertSafeArmId(armId);
  const paths = replayArtifactPaths(runDir, armId);
  if ((await pathExists(paths.synthesis)) || (await pathExists(paths.manifest))) {
    throw new Error(
      `Replay artifacts already exist for arm ${armId}; pass --force to overwrite them.`,
    );
  }
}

export async function loadRecordedRun(
  runDir: string,
): Promise<RecordedJudgeRun> {
  const absoluteRunDir = resolve(runDir);
  const requestText = await readRecordedArtifact(
    absoluteRunDir,
    "request.json",
  );
  const workerRequestsText = await readRecordedArtifact(
    absoluteRunDir,
    "worker-requests.json",
  );
  const workerResultsText = await readRecordedArtifact(
    absoluteRunDir,
    "worker-results.json",
  );
  const synthesisText = await readRecordedArtifact(
    absoluteRunDir,
    "synthesis.json",
  );
  const panelRequest = parseArtifact(requestText, "request.json");
  const workerRequests = parseArtifact(
    workerRequestsText,
    "worker-requests.json",
  );
  const workerResults = parseArtifact(workerResultsText, "worker-results.json");
  const synthesis = parseArtifact(synthesisText, "synthesis.json");

  assertPanelRequest(panelRequest);
  assertWorkerRequests(workerRequests);
  assertWorkerResults(workerResults);
  assertSynthesisResult(synthesis);
  assertConsistentRunIds(panelRequest, workerRequests, workerResults);

  return {
    runDir: absoluteRunDir,
    panelRequest,
    workerRequests,
    workerResults,
    synthesis,
  };
}

export function buildReplayInput(
  recorded: RecordedJudgeRun,
  armConfig: JudgeReplayArmConfig,
): BuiltJudgeReplayInput {
  if (recorded.workerRequests.length !== recorded.workerResults.length) {
    throw new Error(
      "Invalid recorded Fusion artifacts: worker-requests.json and worker-results.json must contain the same number of entries.",
    );
  }
  const panelRequest: PanelRequest = {
    ...recorded.panelRequest,
    synthesizer: {
      strategy: armConfig.judgeHarness,
      model: armConfig.judgeModel,
    },
    workerBudget: {
      ...recorded.panelRequest.workerBudget,
      ...(armConfig.timeoutMs === undefined
        ? {}
        : { timeoutMs: armConfig.timeoutMs }),
    },
  };
  const toolsEnabled = armConfig.toolsMode === "worker-parity";

  return {
    synthesisInput: {
      panelRequest,
      workerRequests: recorded.workerRequests,
      workerResults: recorded.workerResults,
      events: [],
    },
    judgeToolsPolicy: toolsEnabled
      ? deriveWorkerParityToolsPolicy(recorded.workerRequests)
      : undefined,
    judgePromptExtras:
      toolsEnabled || armConfig.groundingAppendix !== undefined
        ? {
            toolsConstraint: toolsEnabled || undefined,
            groundingAppendix: armConfig.groundingAppendix,
          }
        : undefined,
  };
}

export function deriveWorkerParityToolsPolicy(
  workerRequests: WorkerRequest[],
): ToolsPolicy {
  const first = workerRequests[0];
  if (first === undefined) {
    throw new Error(
      "Cannot derive worker-parity tools policy from an empty worker request list.",
    );
  }
  if (first.toolsPolicy === undefined) {
    throw new Error(
      `Recorded worker ${first.workerId} has no toolsPolicy for worker-parity replay.`,
    );
  }
  for (const worker of workerRequests.slice(1)) {
    if (!isDeepStrictEqual(worker.toolsPolicy, first.toolsPolicy)) {
      throw new Error(
        `Recorded workers disagree on toolsPolicy (${first.workerId} versus ${worker.workerId}); worker-parity replay is undefined.`,
      );
    }
  }
  return structuredClone(first.toolsPolicy);
}

export async function writeReplayArtifacts(
  runDir: string,
  armId: string,
  result: SynthesisResult,
  manifestInput: ReplayManifestInput,
): Promise<ReplayArtifactPaths> {
  assertSafeArmId(armId);
  if (manifestInput.armId !== armId) {
    throw new Error(
      `Replay manifest armId ${manifestInput.armId} does not match artifact armId ${armId}.`,
    );
  }
  const absoluteRunDir = resolve(runDir);
  const workerRequestsText = await readRequiredInput(
    absoluteRunDir,
    "worker-requests.json",
  );
  const workerResultsText = await readRequiredInput(
    absoluteRunDir,
    "worker-results.json",
  );
  const { synthesis: synthesisPath, manifest: manifestPath } =
    replayArtifactPaths(absoluteRunDir, armId);
  if (
    manifestInput.force !== true &&
    ((await pathExists(synthesisPath)) || (await pathExists(manifestPath)))
  ) {
    throw new Error(
      `Replay artifacts already exist for arm ${armId}; pass --force to overwrite them.`,
    );
  }
  const manifest: ReplayManifest = {
    armId,
    judge: {
      modelEntry: manifestInput.judgeModelEntry,
      harness: manifestInput.judgeHarness,
    },
    toolsPolicyMode: manifestInput.toolsPolicyMode,
    promptSections: {
      toolsConstraint: manifestInput.toolsConstraintPresent,
      grounding: manifestInput.groundingPresent,
      groundingAppendixSha256:
        manifestInput.groundingAppendix === undefined
          ? undefined
          : sha256(manifestInput.groundingAppendix),
    },
    timeoutMs: manifestInput.timeoutMs,
    timestamp: manifestInput.timestamp ?? new Date().toISOString(),
    inputProvenance: {
      workerRequestsSha256: sha256(workerRequestsText),
      workerResultsSha256: sha256(workerResultsText),
    },
  };
  const flag = manifestInput.force === true ? "w" : "wx";

  try {
    await writeFile(synthesisPath, `${JSON.stringify(result, null, 2)}\n`, {
      flag,
      mode: 0o600,
    });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag,
      mode: 0o600,
    });
  } catch (error) {
    if (isErrnoException(error) && error.code === "EEXIST") {
      throw new Error(
        `Replay artifacts already exist for arm ${armId}; pass --force to overwrite them.`,
      );
    }
    throw error;
  }

  return { synthesis: synthesisPath, manifest: manifestPath };
}

export function resolveRecordedRunDir(run: string, cwd = process.cwd()): string {
  return isAbsolute(run) || run.includes("/") || run.includes("\\")
    ? resolve(cwd, run)
    : resolve(cwd, ".fusion-runs", run);
}

function parseArtifact(text: string, name: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in recorded Fusion artifact ${name}: ${errorMessage(error)}`);
  }
}

function assertPanelRequest(value: unknown): asserts value is PanelRequest {
  if (!isRecord(value) || !isString(value.panelRunId) || !isString(value.prompt)) {
    throw new Error("Invalid recorded Fusion artifact request.json: expected a PanelRequest.");
  }
  if (!isRecord(value.sharedContext) || !isRecord(value.panelSpec)) {
    throw new Error("Invalid recorded Fusion artifact request.json: missing panel structure.");
  }
}

function assertWorkerRequests(value: unknown): asserts value is WorkerRequest[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (entry) =>
        !isRecord(entry) ||
        !isString(entry.panelRunId) ||
        !isString(entry.workerId) ||
        !isString(entry.prompt) ||
        !isRecord(entry.outputContract),
    )
  ) {
    throw new Error(
      "Invalid recorded Fusion artifact worker-requests.json: expected a non-empty WorkerRequest array.",
    );
  }
}

function assertWorkerResults(value: unknown): asserts value is WorkerResult[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (entry) =>
        !isRecord(entry) ||
        !isString(entry.panelRunId) ||
        !isString(entry.workerId) ||
        !isString(entry.status) ||
        !isString(entry.output),
    )
  ) {
    throw new Error(
      "Invalid recorded Fusion artifact worker-results.json: expected a non-empty WorkerResult array.",
    );
  }
}

function assertSynthesisResult(value: unknown): asserts value is SynthesisResult {
  if (!isRecord(value) || !isString(value.synthesis)) {
    throw new Error(
      "Invalid recorded Fusion artifact synthesis.json: expected a SynthesisResult.",
    );
  }
}

function assertConsistentRunIds(
  request: PanelRequest,
  workerRequests: WorkerRequest[],
  workerResults: WorkerResult[],
): void {
  const mismatch = [...workerRequests, ...workerResults].find(
    (artifact) => artifact.panelRunId !== request.panelRunId,
  );
  if (mismatch !== undefined) {
    throw new Error(
      `Recorded Fusion artifacts disagree on panelRunId: expected ${request.panelRunId}, found ${mismatch.panelRunId}.`,
    );
  }
}

async function readRequiredInput(runDir: string, name: string): Promise<string> {
  try {
    return await readFile(join(runDir, name), "utf8");
  } catch (error) {
    throw new Error(
      `Cannot write replay provenance without ${name}: ${errorMessage(error)}`,
    );
  }
}

async function readRecordedArtifact(
  runDir: string,
  name: (typeof recordedArtifactNames)[number],
): Promise<string> {
  const path = join(runDir, name);
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new Error(
      `Recorded Fusion run is missing or cannot read ${name} at ${path}: ${errorMessage(error)}`,
    );
  }
}

function assertSafeArmId(armId: string): void {
  if (!/^[A-Za-z0-9._-]+$/u.test(armId)) {
    throw new Error(
      "Replay arm id must contain only letters, numbers, dots, underscores, or hyphens.",
    );
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function replayArtifactPaths(
  runDir: string,
  armId: string,
): ReplayArtifactPaths {
  const absoluteRunDir = resolve(runDir);
  return {
    synthesis: join(absoluteRunDir, `synthesis-replay-${armId}.json`),
    manifest: join(absoluteRunDir, `replay-manifest-${armId}.json`),
  };
}
