import { spawn } from "node:child_process";
import type {
  HarnessKind,
  ModelPreference,
  WorkerRequest,
  WorkerResult,
  WorkerRunner,
} from "./types";

export interface CommandExecution {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean;
}

export type CommandExecutor = (
  execution: CommandExecution,
) => Promise<CommandResult>;

export interface HeadlessCliAdapterOptions {
  command?: string;
  executor?: CommandExecutor;
}

export class OpenCodeHeadlessCliAdapter implements WorkerRunner {
  private readonly command: string;
  private readonly executor: CommandExecutor;

  constructor(options: HeadlessCliAdapterOptions = {}) {
    this.command = options.command ?? "opencode";
    this.executor = options.executor ?? executeCommand;
  }

  async runWorker(request: WorkerRequest): Promise<WorkerResult> {
    const result = await this.executor({
      command: this.command,
      args: buildOpenCodeArgs(request),
      cwd:
        request.environment?.workingDirectory ??
        request.environment?.workspaceRoot,
      timeoutMs: request.budget?.timeoutMs,
    });
    return cliResultToWorkerResult("opencode", request, result);
  }
}

export class ClaudeCodeHeadlessCliAdapter implements WorkerRunner {
  private readonly command: string;
  private readonly executor: CommandExecutor;

  constructor(options: HeadlessCliAdapterOptions = {}) {
    this.command = options.command ?? "claude";
    this.executor = options.executor ?? executeCommand;
  }

  async runWorker(request: WorkerRequest): Promise<WorkerResult> {
    const result = await this.executor({
      command: this.command,
      args: buildClaudeCodeArgs(request),
      cwd:
        request.environment?.workingDirectory ??
        request.environment?.workspaceRoot,
      timeoutMs: request.budget?.timeoutMs,
    });
    return cliResultToWorkerResult("claude-code", request, result);
  }
}

export function buildOpenCodeArgs(request: WorkerRequest): string[] {
  const args = ["run", "--format", "json", "--pure"];
  const model = modelPreferenceToModel(request.modelPreference);
  if (model !== undefined) {
    args.push("--model", model);
  }
  return [...args, renderWorkerPrompt(request)];
}

export function buildClaudeCodeArgs(request: WorkerRequest): string[] {
  const args = [
    "--print",
    "--verbose",
    "--output-format",
    "stream-json",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
  ];
  const model = request.modelPreference?.model;
  if (model !== undefined) {
    args.push("--model", model);
  }
  const fallbackModel = request.modelPreference?.fallbacks?.[0];
  if (fallbackModel !== undefined) {
    args.push("--fallback-model", fallbackModel);
  }
  const tools = claudeToolsForPolicy(request);
  if (tools !== undefined) {
    args.push(`--tools=${tools}`);
  }
  return [...args, renderWorkerPrompt(request)];
}

export async function executeCommand(
  execution: CommandExecution,
): Promise<CommandResult> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const child = spawn(execution.command, execution.args, {
      cwd: execution.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout =
      execution.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            setTimeout(() => {
              if (child.exitCode === null) {
                child.kill("SIGKILL");
              }
            }, 1_000).unref();
          }, execution.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      resolve({
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });
  });
}

function cliResultToWorkerResult(
  kind: HarnessKind,
  request: WorkerRequest,
  result: CommandResult,
): WorkerResult {
  const isOpenCode = kind === "opencode";
  const parsedOutput = parseTextOutput(result.stdout);
  const output = parsedOutput.ok ? parsedOutput.output.trim() : "";
  const ok = result.exitCode === 0 && output.length > 0 && !result.timedOut;

  return {
    panelRunId: request.panelRunId,
    workerId: request.workerId,
    status: workerStatusForCliResult(result, parsedOutput, output),
    output,
    modelUsed: modelPreferenceToModel(request.modelPreference),
    harnessUsed: { kind, invocation: "headless" },
    usage: { durationMs: result.durationMs },
    complianceEvidence: {
      adapterClaimsIndependentInvocation: request.session.mode === "fresh",
      adapterClaimsIsolatedContext: request.session.mode === "fresh",
      adapterClaimsBlindness: true,
      observedSessionMode: request.session.mode,
      observedToolPolicy: isOpenCode ? undefined : request.toolsPolicy,
      notes: adapterComplianceNotes(kind),
    },
    warnings:
      ok && isOpenCode
        ? [
            "OpenCode CLI adapter result is degraded until tool policy evidence is proven.",
          ]
        : undefined,
    errors: cliErrors(kind, result, parsedOutput, output),
  };
}

function workerStatusForCliResult(
  result: CommandResult,
  parsedOutput: ParsedOutput,
  output: string,
): WorkerResult["status"] {
  if (result.timedOut === true) {
    return "timeout";
  }
  if (!parsedOutput.ok) {
    return "invalid-output";
  }
  if (result.exitCode === 0 && output.length > 0) {
    return "ok";
  }
  return "error";
}

function cliErrors(
  kind: HarnessKind,
  result: CommandResult,
  parsedOutput: ParsedOutput,
  output: string,
): string[] | undefined {
  if (result.timedOut === true) {
    return [`${kind} worker timed out after ${result.durationMs}ms.`];
  }
  if (!parsedOutput.ok) {
    return [`${kind} returned invalid JSON output: ${parsedOutput.error}`];
  }
  if (result.exitCode !== 0) {
    return [
      `${kind} exited with code ${result.exitCode}: ${snippet(result.stderr || result.stdout)}`,
    ];
  }
  if (output.length === 0) {
    return [`${kind} exited successfully but returned no worker output.`];
  }
  return undefined;
}

function adapterComplianceNotes(kind: HarnessKind): string[] {
  if (kind === "opencode") {
    return [
      "OpenCode CLI adapter cannot yet prove exact tool policy enforcement.",
    ];
  }

  return [
    "Claude Code CLI adapter uses dontAsk and explicit tool flags when available.",
  ];
}

function renderWorkerPrompt(request: WorkerRequest): string {
  return [
    request.prompt,
    "",
    "You are one independent Fusion panel worker.",
    "Do not mention or infer peer worker outputs, draft synthesis, or panel conclusions.",
    "Return only the requested answer; do not include hidden chain-of-thought.",
    "",
    "Shared context:",
    request.sharedContext.text ?? "",
  ].join("\n");
}

export function modelPreferenceToModel(
  modelPreference: ModelPreference | undefined,
): string | undefined {
  if (
    modelPreference?.provider !== undefined &&
    modelPreference.model !== undefined
  ) {
    return `${modelPreference.provider}/${modelPreference.model}`;
  }
  return modelPreference?.model ?? modelPreference?.aliases?.[0];
}

function claudeToolsForPolicy(request: WorkerRequest): string | undefined {
  switch (request.toolsPolicy?.mode) {
    case "none":
      return "";
    case "read-only":
      return (
        request.toolsPolicy.allow?.join(",") ??
        "Read,Grep,Glob,LS,WebSearch,WebFetch"
      );
    case "limited":
      return request.toolsPolicy.allow?.join(",");
    case "full":
    case undefined:
      return undefined;
  }
}

type ParsedOutput = { ok: true; output: string } | { ok: false; error: string };

function parseTextOutput(stdout: string): ParsedOutput {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return { ok: true, output: "" };
  }

  const extracted: string[] = [];
  for (const line of lines) {
    const parsed = extractJsonLineText(line);
    if (!parsed.ok) {
      return parsed;
    }
    if (parsed.output.length > 0) {
      extracted.push(parsed.output);
    }
  }
  if (extracted.length === 0) {
    return { ok: false, error: "no result text found in JSON output" };
  }
  return { ok: true, output: extracted.join("\n") };
}

function extractJsonLineText(line: string): ParsedOutput {
  try {
    const value = JSON.parse(line) as unknown;
    if (value === null || typeof value !== "object") {
      return { ok: false, error: "JSON line is not an object" };
    }

    const record = value as Record<string, unknown>;
    if (typeof record.result === "string") {
      return { ok: true, output: record.result };
    }
    if (typeof record.message === "string") {
      return { ok: true, output: record.message };
    }
    if (typeof record.text === "string") {
      return { ok: true, output: record.text };
    }
    const partText = textFromRecordPart(record.part);
    if (partText !== undefined) {
      return { ok: true, output: partText };
    }
    if (Array.isArray(record.content)) {
      return {
        ok: true,
        output: record.content
          .map(textFromContentPart)
          .filter((part): part is string => part !== undefined)
          .join("\n"),
      };
    }
  } catch {
    return { ok: false, error: "JSON line could not be parsed" };
  }
  return { ok: true, output: "" };
}

function textFromRecordPart(part: unknown): string | undefined {
  if (part === null || typeof part !== "object") {
    return undefined;
  }

  const record = part as Record<string, unknown>;
  if (record.type !== "text") {
    return undefined;
  }
  return typeof record.text === "string" ? record.text : undefined;
}

function textFromContentPart(part: unknown): string | undefined {
  if (part === null || typeof part !== "object" || !("text" in part)) {
    return undefined;
  }

  return String(part.text);
}

export function snippet(value: string): string {
  const trimmed = value.trim();
  return trimmed.length === 0 ? "no stderr/stdout" : trimmed.slice(0, 500);
}
