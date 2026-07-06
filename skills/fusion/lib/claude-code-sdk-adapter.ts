import {
  buildClaudeCodeSdkArgs,
  executeCommand,
  snippet,
  type CommandExecutor,
  type CommandResult,
} from "./headless-cli-adapters";
import type {
  WorkerRequest,
  WorkerResult,
  WorkerRunner,
} from "./types";

export interface ClaudeCodeSdkAdapterOptions {
  command?: string;
  executor?: CommandExecutor;
}

interface ClaudeStreamResult {
  output: string;
  modelUsed?: string;
  sessionId?: string;
  usage?: WorkerResult["usage"];
  permissionDenials: string[];
  assistantTexts: string[];
  resultIsError: boolean;
  numTurns?: number;
}

type ParsedClaudeStream =
  | { ok: true; result: ClaudeStreamResult }
  | { ok: false; error: string };

export class ClaudeCodeSdkAdapter implements WorkerRunner {
  private readonly command: string;
  private readonly executor: CommandExecutor;

  constructor(options: ClaudeCodeSdkAdapterOptions = {}) {
    this.command = options.command ?? "claude";
    this.executor = options.executor ?? executeCommand;
  }

  async runWorker(request: WorkerRequest): Promise<WorkerResult> {
    const commandResult = await this.executor({
      command: this.command,
      args: buildClaudeCodeSdkArgs(request),
      cwd:
        request.environment?.workingDirectory ??
        request.environment?.workspaceRoot,
      timeoutMs: request.budget?.timeoutMs,
    });
    return sdkResultToWorkerResult(request, commandResult);
  }
}

function sdkResultToWorkerResult(
  request: WorkerRequest,
  commandResult: CommandResult,
): WorkerResult {
  const parsed = parseClaudeStreamJson(commandResult.stdout);
  const output = parsed.ok ? parsed.result.output.trim() : "";
  const permissionDenials = parsed.ok ? parsed.result.permissionDenials : [];
  const warnings = claudeSdkWarnings(request, permissionDenials);

  return {
    panelRunId: request.panelRunId,
    workerId: request.workerId,
    status: workerStatusForClaudeSdk(commandResult, parsed, output),
    output,
    modelUsed: parsed.ok ? parsed.result.modelUsed : undefined,
    harnessUsed: {
      kind: "claude-code",
      invocation: "headless",
      transport: "sdk",
    },
    sessionId: parsed.ok ? parsed.result.sessionId : undefined,
    usage: {
      durationMs:
        parsed.ok && parsed.result.usage?.durationMs !== undefined
          ? parsed.result.usage.durationMs
          : commandResult.durationMs,
      ...(parsed.ok ? withoutDuration(parsed.result.usage) : {}),
    },
    complianceEvidence: {
      adapterClaimsIndependentInvocation: request.session.mode === "fresh",
      adapterClaimsIsolatedContext: request.session.mode === "fresh",
      adapterClaimsBlindness: true,
      observedSessionMode: request.session.mode,
      observedToolPolicy: request.toolsPolicy,
      notes: claudeSdkComplianceNotes(
        request,
        permissionDenials,
        warnings,
        parsed.ok ? parsed.result.numTurns : undefined,
      ),
    },
    warnings: warnings.length === 0 ? undefined : warnings,
    errors: claudeSdkErrors(commandResult, parsed, output),
  };
}

function withoutDuration(
  usage: WorkerResult["usage"] | undefined,
): Omit<NonNullable<WorkerResult["usage"]>, "durationMs"> {
  if (usage === undefined) {
    return {};
  }
  const { durationMs: _durationMs, ...rest } = usage;
  return rest;
}

function workerStatusForClaudeSdk(
  commandResult: CommandResult,
  parsed: ParsedClaudeStream,
  output: string,
): WorkerResult["status"] {
  if (commandResult.timedOut === true) {
    return "timeout";
  }
  if (!parsed.ok) {
    return "invalid-output";
  }
  if (commandResult.exitCode === 0 && output.length > 0) {
    return parsed.result.resultIsError ? "error" : "ok";
  }
  return "error";
}

function claudeSdkErrors(
  commandResult: CommandResult,
  parsed: ParsedClaudeStream,
  output: string,
): string[] | undefined {
  if (commandResult.timedOut === true) {
    return [`claude-code SDK worker timed out after ${commandResult.durationMs}ms.`];
  }
  if (!parsed.ok) {
    return [`claude-code returned invalid stream-json output: ${parsed.error}`];
  }
  if (commandResult.exitCode !== 0) {
    return [
      `claude-code exited with code ${commandResult.exitCode}: ${snippet(commandResult.stderr || commandResult.stdout)}`,
    ];
  }
  if (parsed.result.resultIsError) {
    return ["claude-code stream-json result reported an error."];
  }
  if (output.length === 0) {
    return ["claude-code exited successfully but returned no worker output."];
  }
  return undefined;
}

function claudeSdkComplianceNotes(
  request: WorkerRequest,
  permissionDenials: string[],
  warnings: string[],
  numTurns: number | undefined,
): string[] {
  const notes = [
    "Claude Code SDK adapter parsed stream-json init and result metadata.",
  ];
  if (request.reasoning?.effort !== undefined) {
    notes.push(`reasoning.effort mapped through claude --effort ${request.reasoning.effort}.`);
  }
  if (request.toolsPolicy?.readOnlyBashCommands !== undefined) {
    notes.push(
      "Claude Code Bash access is restricted with --allowedTools command patterns and --permission-mode dontAsk.",
    );
  }
  if (request.environment?.readRoots !== undefined) {
    notes.push(
      `Claude Code read roots mapped through --add-dir: ${request.environment.readRoots.join(", ")}.`,
    );
  }
  if (numTurns !== undefined) {
    notes.push(`Claude Code result num_turns: ${numTurns}.`);
  }
  notes.push(...permissionDenials.map((denial) => `Claude Code permission denial: ${denial}`));
  notes.push(...warnings);
  return notes;
}

function claudeSdkWarnings(
  request: WorkerRequest,
  permissionDenials: string[],
): string[] {
  const warnings = unmappedPreferenceWarnings("claude-code", request);
  if (permissionDenials.length > 0) {
    warnings.push(
      `Claude Code reported ${permissionDenials.length} permission denial${permissionDenials.length === 1 ? "" : "s"}.`,
    );
  }
  return warnings;
}

function unmappedPreferenceWarnings(
  kind: string,
  request: WorkerRequest,
): string[] {
  const warnings: string[] = [];
  if (request.reasoning?.maxTokens !== undefined) {
    warnings.push(
      `${kind} does not expose a CLI flag for reasoning.maxTokens; requested ${request.reasoning.maxTokens} was not mapped.`,
    );
  }
  if (request.budget?.maxTurns !== undefined) {
    warnings.push(
      `${kind} does not expose a CLI turn-cap flag in installed help; requested maxTurns=${request.budget.maxTurns} was not mapped.`,
    );
  }
  return warnings;
}

export function parseClaudeStreamJson(stdout: string): ParsedClaudeStream {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const parsed: ClaudeStreamResult = {
    output: "",
    permissionDenials: [],
    assistantTexts: [],
    resultIsError: false,
  };

  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      return { ok: false, error: "JSON line could not be parsed" };
    }
    if (value === null || typeof value !== "object") {
      return { ok: false, error: "JSON line is not an object" };
    }
    applyClaudeStreamRecord(parsed, value as Record<string, unknown>);
  }

  if (parsed.output.length === 0) {
    parsed.output = parsed.assistantTexts.join("\n");
  }
  return { ok: true, result: parsed };
}

function applyClaudeStreamRecord(
  parsed: ClaudeStreamResult,
  record: Record<string, unknown>,
): void {
  if (record.type === "system" && record.subtype === "init") {
    parsed.sessionId = stringField(record, "session_id") ?? parsed.sessionId;
    parsed.modelUsed =
      stringField(record, "model") ??
      stringField(record, "model_id") ??
      parsed.modelUsed;
    return;
  }

  if (record.type === "assistant") {
    const text = textFromClaudeContent(record.message);
    if (text !== undefined && text.length > 0) {
      parsed.assistantTexts.push(text);
    }
    return;
  }

  if (record.type !== "result") {
    return;
  }

  parsed.resultIsError = record.is_error === true;
  parsed.output = stringField(record, "result") ?? parsed.output;
  parsed.sessionId = stringField(record, "session_id") ?? parsed.sessionId;
  parsed.modelUsed =
    stringField(record, "model") ??
    stringField(record, "resolved_model") ??
    parsed.modelUsed;
  parsed.usage = claudeUsage(record);
  parsed.permissionDenials = permissionDenials(record.permission_denials);
  parsed.numTurns = numberField(record, "num_turns");
}

function claudeUsage(record: Record<string, unknown>): WorkerResult["usage"] {
  const usage = objectField(record, "usage");
  return {
    durationMs: numberField(record, "duration_ms"),
    inputTokens: usage === undefined ? undefined : numberField(usage, "input_tokens"),
    outputTokens:
      usage === undefined ? undefined : numberField(usage, "output_tokens"),
    costUsd: numberField(record, "total_cost_usd"),
  };
}

function permissionDenials(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(formatPermissionDenial);
}

function formatPermissionDenial(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || typeof value !== "object") {
    return String(value);
  }
  const record = value as Record<string, unknown>;
  const tool =
    stringField(record, "tool_name") ??
    stringField(record, "toolName") ??
    stringField(record, "tool") ??
    "unknown tool";
  const toolUseId =
    stringField(record, "tool_use_id") ?? stringField(record, "toolUseId");
  const toolInput = formatToolInput(record.tool_input);
  const pattern =
    stringField(record, "pattern") ??
    stringField(record, "command") ??
    stringField(record, "input");
  const reason = stringField(record, "reason") ?? stringField(record, "message");
  return [tool, toolUseId, toolInput ?? pattern, reason]
    .filter((part): part is string => part !== undefined)
    .join(": ");
}

function formatToolInput(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function textFromClaudeContent(message: unknown): string | undefined {
  const messageRecord = objectValue(message);
  const content = messageRecord?.content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  return content
    .map((part) => {
      const partRecord = objectValue(part);
      return partRecord?.type === "text" ? stringField(partRecord, "text") : undefined;
    })
    .filter((text): text is string => text !== undefined)
    .join("\n");
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function objectField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  return objectValue(record[key]);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
