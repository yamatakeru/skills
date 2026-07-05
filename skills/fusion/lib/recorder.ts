import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage } from "./errors";
import type {
  ComplianceSummary,
  ContextManifest,
  PanelRequest,
  PanelResult,
  ProvenanceEvent,
  RecordingStatus,
  RunRecorder,
  SynthesisResult,
  WorkerRequest,
  WorkerResult,
} from "./types";

export class NoopRunRecorder implements RunRecorder {
  readonly status: RecordingStatus = "not-recorded";
}

export interface FileRunRecorderOptions {
  workspaceRoot: string;
  panelRunId: string;
  rootDirectory?: string;
  allowUnignoredDirectory?: boolean;
  redactSecrets?: boolean;
}

export class FileRunRecorder implements RunRecorder {
  private currentStatus: RecordingStatus = "not-recorded";
  private initialized = false;
  private readonly runDirectory: string;
  private readonly redactSecrets: boolean;

  constructor(private readonly options: FileRunRecorderOptions) {
    assertSafePathSegment(options.panelRunId, "panelRunId");
    if (
      options.rootDirectory !== undefined &&
      options.allowUnignoredDirectory !== true
    ) {
      throw new Error(
        "Custom Fusion recorder rootDirectory requires allowUnignoredDirectory.",
      );
    }
    this.runDirectory = defaultRunDirectory(
      options.workspaceRoot,
      options.panelRunId,
      options.rootDirectory,
    );
    this.redactSecrets = options.redactSecrets ?? true;
  }

  get status(): RecordingStatus {
    return this.currentStatus;
  }

  async recordRequest(request: PanelRequest): Promise<void> {
    await this.writeJson("request.json", request);
  }

  async recordManifest(manifest: ContextManifest): Promise<void> {
    await this.writeJson("manifest.json", manifest);
  }

  async recordEvent(event: ProvenanceEvent): Promise<void> {
    await this.ensureInitialized();
    await this.writeFileSafely(
      "events.jsonl",
      `${JSON.stringify(this.redact(event))}\n`,
      { append: true },
    );
  }

  async recordWorkerRequests(requests: WorkerRequest[]): Promise<void> {
    await this.writeJson("worker-requests.json", requests);
  }

  async recordWorkerResults(results: WorkerResult[]): Promise<void> {
    await this.writeJson("worker-results.json", results);
  }

  async recordSynthesis(result: SynthesisResult): Promise<void> {
    await this.writeJson("synthesis.json", result);
  }

  async recordCompliance(summary: ComplianceSummary): Promise<void> {
    await this.writeJson("compliance.json", summary);
  }

  async recordResult(result: PanelResult): Promise<void> {
    await this.writeJson("result.json", result);
    this.currentStatus = "complete";
  }

  private async writeJson(fileName: string, value: unknown): Promise<void> {
    await this.ensureInitialized();
    await this.writeFileSafely(
      fileName,
      `${JSON.stringify(this.redact(value), null, 2)}\n`,
    );
  }

  private async writeFileSafely(
    fileName: string,
    content: string,
    options: { append?: boolean } = {},
  ): Promise<void> {
    try {
      await writeFile(join(this.runDirectory, fileName), content, {
        flag: options.append === true ? "a" : "w",
        mode: 0o600,
      });
      this.currentStatus = "partial";
    } catch (error) {
      this.currentStatus = "failed";
      throw new Error(
        `Failed to write Fusion recorder artifact ${fileName}: ${errorMessage(error)}`,
      );
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    try {
      await this.assertRecordingDirectoryIsSafe();
      await mkdir(this.runDirectory, { recursive: true, mode: 0o700 });
      this.initialized = true;
      this.currentStatus = "partial";
    } catch (error) {
      this.currentStatus = "failed";
      throw error;
    }
  }

  private async assertRecordingDirectoryIsSafe(): Promise<void> {
    if (this.options.allowUnignoredDirectory === true) {
      return;
    }
    const gitignore = await readGitignore(this.options.workspaceRoot);
    if (
      !gitignore.split(/\r?\n/u).some((line) => line.trim() === ".fusion-runs/")
    ) {
      throw new Error(
        "Refusing to record Fusion run because .fusion-runs/ is not git-ignored.",
      );
    }
  }

  private redact(value: unknown): unknown {
    if (!this.redactSecrets) {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.redact(item));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
          key,
          isSecretKey(key) ? "[REDACTED]" : this.redact(entry),
        ]),
      );
    }
    if (typeof value === "string") {
      return redactSecretString(value);
    }
    return value;
  }
}

export function createFileRunRecorder(
  options: FileRunRecorderOptions,
): FileRunRecorder {
  return new FileRunRecorder(options);
}

export function defaultRunDirectory(
  workspaceRoot: string,
  panelRunId: string,
  rootDirectory?: string,
): string {
  assertSafePathSegment(panelRunId, "panelRunId");
  return join(rootDirectory ?? join(workspaceRoot, ".fusion-runs"), panelRunId);
}

function assertSafePathSegment(value: string, label: string): void {
  if (!/^[A-Za-z0-9._-]+$/u.test(value)) {
    throw new Error(`${label} must be a safe path segment.`);
  }
}

function isSecretKey(key: string): boolean {
  return /(?:api[_-]?key|token|secret|password|credential)/iu.test(key);
}

function redactSecretString(value: string): string {
  return value
    .replace(
      /((?:api[_-]?key|token|secret|password|credential)=)[^\s&]+/giu,
      "$1[REDACTED]",
    )
    .replace(/(authorization:\s*bearer\s+)[^\s]+/giu, "$1[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gu, "[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{12,}\b/gu, "[REDACTED]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/gu, "[REDACTED]")
    .replace(
      /-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/gu,
      "[REDACTED PRIVATE KEY]",
    );
}

async function readGitignore(workspaceRoot: string): Promise<string> {
  const gitignorePath = join(workspaceRoot, ".gitignore");
  try {
    return await readFile(gitignorePath, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return "";
    }
    throw new Error(
      `Unable to verify Fusion recorder gitignore safety at ${gitignorePath}: ${errorMessage(error)}`,
    );
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
