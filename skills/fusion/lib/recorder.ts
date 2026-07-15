import {
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
  onSignalCleanup?: () => Promise<void>;
  signalCleanupTimeoutMs?: number;
}

export class FileRunRecorder implements RunRecorder {
  private currentStatus: RecordingStatus = "not-recorded";
  private initialized = false;
  private startedAt: string | undefined;
  private nextTemporaryFileId = 0;
  private readonly signalHandlers = new Map<
    "SIGINT" | "SIGTERM",
    () => Promise<void>
  >();
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
    await this.finalize(result.status === "failed" ? "failed" : "complete");
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
      if (options.append === true) {
        await writeFile(join(this.runDirectory, fileName), content, {
          flag: "a",
          mode: 0o600,
        });
      } else {
        await this.writeFileAtomically(fileName, content);
      }
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
      this.startedAt = new Date().toISOString();
      this.writeRunStatusSync("running");
      this.registerSignalHandlers();
      this.initialized = true;
      this.currentStatus = "partial";
    } catch (error) {
      this.currentStatus = "failed";
      throw error;
    }
  }

  private async finalize(status: "complete" | "failed"): Promise<void> {
    try {
      await this.writeFileSafely(
        "run-status.json",
        `${JSON.stringify({
          status,
          startedAt: this.startedAt,
          endedAt: new Date().toISOString(),
        }, null, 2)}\n`,
      );
      this.currentStatus = status;
    } finally {
      this.deregisterSignalHandlers();
    }
  }

  private async writeFileAtomically(
    fileName: string,
    content: string,
  ): Promise<void> {
    const targetPath = join(this.runDirectory, fileName);
    const temporaryPath = this.temporaryPath(fileName);
    try {
      await writeFile(temporaryPath, content, { flag: "wx", mode: 0o600 });
      await rename(temporaryPath, targetPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private writeRunStatusSync(
    status: "running" | "aborted",
  ): void {
    const content =
      status === "running"
        ? { status, startedAt: this.startedAt }
        : {
            status,
            startedAt: this.startedAt,
            endedAt: new Date().toISOString(),
          };
    const targetPath = join(this.runDirectory, "run-status.json");
    const temporaryPath = this.temporaryPath("run-status.json");
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(content, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temporaryPath, targetPath);
    } catch (error) {
      try {
        rmSync(temporaryPath, { force: true });
      } catch {
        // The original status-write error is the actionable failure.
      }
      throw error;
    }
  }

  private temporaryPath(fileName: string): string {
    this.nextTemporaryFileId += 1;
    return join(
      this.runDirectory,
      `.${fileName}.${process.pid}.${this.nextTemporaryFileId}.tmp`,
    );
  }

  private registerSignalHandlers(): void {
    const signals = [
      ["SIGINT", 130],
      ["SIGTERM", 143],
    ] as const;
    for (const [signal, exitCode] of signals) {
      const handler = async (): Promise<void> => {
        this.deregisterSignalHandlers();
        try {
          this.writeRunStatusSync("aborted");
        } catch {
          // Signal handling is best-effort; preserve the expected signal exit.
        }
        if (this.options.onSignalCleanup !== undefined) {
          await runBoundedCleanup(
            this.options.onSignalCleanup,
            this.options.signalCleanupTimeoutMs,
          );
        }
        process.exit(exitCode);
      };
      this.signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }
  }

  private deregisterSignalHandlers(): void {
    for (const [signal, handler] of this.signalHandlers) {
      process.off(signal, handler);
    }
    this.signalHandlers.clear();
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

export async function runBoundedCleanup(
  cleanup: () => Promise<void>,
  timeoutMs = 5_000,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(cleanup).catch(() => undefined),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
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
