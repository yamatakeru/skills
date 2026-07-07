import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeCommand,
  modelPreferenceToModel,
  snippet,
  type CommandExecutor,
  type CommandResult,
} from "./headless-cli-adapters";
import type {
  ToolsPolicy,
  WorkerRequest,
  WorkerResult,
  WorkerRunner,
} from "./types";

export interface CursorSdkAdapterOptions {
  command?: string;
  executor?: CommandExecutor;
}

export type CursorExecutionProfile = "worker" | "judge";

export interface CursorConfigContent {
  permissions: {
    deny: string[];
  };
}

interface CursorStreamResult {
  output: string;
  requestedModelId?: string;
  modelDisplayName?: string;
  sessionId?: string;
  permissionMode?: string;
  cwd?: string;
  requestId?: string;
  usage?: WorkerResult["usage"];
  toolObservations: CursorToolObservation[];
  assistantTexts: string[];
  nonJsonLines: string[];
  unknownEventTypes: string[];
  resultIsError: boolean;
}

interface CursorToolObservation {
  tool: string;
  status:
    | "started"
    | "success"
    | "rejected"
    | "permissionDenied"
    | "writePermissionDenied"
    | "error"
    | "unknown";
  detail?: string;
}

type ParsedCursorStream = { ok: true; result: CursorStreamResult };

const workerDenyList = ["Shell(**)", "Write(**)", "Delete(**)", "Mcp(*)"];
const judgeDenyList = [...workerDenyList, "Read(**)"];
const toleratedCursorEventTypes = new Set([
  "system",
  "user",
  "assistant",
  "tool_call",
  "interaction_query",
  "result",
  "thinking",
  "connection",
  "retry",
]);

export class CursorSdkAdapter implements WorkerRunner {
  private readonly command: string;
  private readonly executor: CommandExecutor;

  constructor(options: CursorSdkAdapterOptions = {}) {
    this.command = options.command ?? "cursor-agent";
    this.executor = options.executor ?? executeCommand;
  }

  async runWorker(request: WorkerRequest): Promise<WorkerResult> {
    const startedAt = Date.now();
    const profile = cursorExecutionProfile(request);
    let configDir: string | undefined;
    try {
      configDir = await writeCursorConfig(profile);
      const commandResult = await this.executor({
        command: this.command,
        args: buildCursorSdkArgs(request),
        cwd:
          request.environment?.workingDirectory ??
          request.environment?.workspaceRoot,
        env: { CURSOR_CONFIG_DIR: configDir },
        timeoutMs: request.budget?.timeoutMs,
      });
      return cursorSdkResultToWorkerResult(request, commandResult, profile);
    } catch (error) {
      return cursorWorkerResult({
        request,
        profile,
        status: "error",
        output: "",
        usage: { durationMs: Date.now() - startedAt },
        tools: [],
        nonJsonLines: [],
        warnings: cursorSdkWarnings(request, profile, [], [], []),
        errors: [snippet(String(error))],
      });
    } finally {
      if (configDir !== undefined) {
        await rm(configDir, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
    }
  }
}

export function buildCursorSdkArgs(request: WorkerRequest): string[] {
  const profile = cursorExecutionProfile(request);
  const args = ["--print", "--output-format", "stream-json", "--trust"];
  if (profile === "worker") {
    args.push("--force");
  }
  const model = modelPreferenceToModel(request.modelPreference);
  if (model !== undefined) {
    args.push("--model", model);
  }
  for (const root of request.environment?.readRoots ?? []) {
    args.push("--add-dir", root);
  }
  return [...args, "--", request.prompt];
}

export function buildCursorConfigContent(
  profile: CursorExecutionProfile,
): CursorConfigContent {
  return {
    permissions: {
      deny: profile === "judge" ? judgeDenyList : workerDenyList,
    },
  };
}

async function writeCursorConfig(
  profile: CursorExecutionProfile,
): Promise<string> {
  const configDir = await mkdtemp(join(tmpdir(), "fusion-cursor-"));
  try {
    await writeFile(
      join(configDir, "cli-config.json"),
      `${JSON.stringify(buildCursorConfigContent(profile), null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    await rm(configDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return configDir;
}

function cursorExecutionProfile(
  request: WorkerRequest,
): CursorExecutionProfile {
  return request.workerId === "judge" ? "judge" : "worker";
}

function cursorSdkResultToWorkerResult(
  request: WorkerRequest,
  commandResult: CommandResult,
  profile: CursorExecutionProfile,
): WorkerResult {
  const parsed = parseCursorStreamJson(
    commandResult.stdout,
    modelPreferenceToModel(request.modelPreference),
  );
  const output = parsed.result.output.trim();
  const warnings = cursorSdkWarnings(
    request,
    profile,
    parsed.result.toolObservations,
    parsed.result.nonJsonLines,
    parsed.result.unknownEventTypes,
  );

  return cursorWorkerResult({
    request,
    profile,
    status: workerStatusForCursorSdk(commandResult, parsed, output),
    output,
    modelUsed:
      parsed.result.modelDisplayName ?? parsed.result.requestedModelId,
    sessionId: parsed.result.sessionId,
    usage: {
      durationMs:
        parsed.result.usage?.durationMs !== undefined
          ? parsed.result.usage.durationMs
          : commandResult.durationMs,
      ...withoutDuration(parsed.result.usage),
    },
    tools: parsed.result.toolObservations,
    nonJsonLines: parsed.result.nonJsonLines,
    permissionMode: parsed.result.permissionMode,
    cwd: parsed.result.cwd,
    requestId: parsed.result.requestId,
    requestedModelId: parsed.result.requestedModelId,
    modelDisplayName: parsed.result.modelDisplayName,
    warnings,
    errors: cursorSdkErrors(commandResult, parsed, output),
  });
}

function cursorWorkerResult(input: {
  request: WorkerRequest;
  profile: CursorExecutionProfile;
  status: WorkerResult["status"];
  output: string;
  modelUsed?: string;
  sessionId?: string;
  usage?: WorkerResult["usage"];
  tools: CursorToolObservation[];
  nonJsonLines: string[];
  permissionMode?: string;
  cwd?: string;
  requestId?: string;
  requestedModelId?: string;
  modelDisplayName?: string;
  warnings: string[];
  errors?: string[];
}): WorkerResult {
  return {
    panelRunId: input.request.panelRunId,
    workerId: input.request.workerId,
    status: input.status,
    output: input.output,
    modelUsed: input.modelUsed,
    harnessUsed: {
      kind: "cursor",
      invocation: "headless",
      transport: "sdk",
    },
    sessionId: input.sessionId,
    toolUseSummary: cursorToolUseSummary(input.tools),
    usage: input.usage,
    complianceEvidence: {
      adapterClaimsIndependentInvocation:
        input.request.session.mode === "fresh" && input.sessionId !== undefined,
      adapterClaimsIsolatedContext: false,
      adapterClaimsBlindness: true,
      observedSessionMode: input.request.session.mode,
      observedToolPolicy: observedCursorToolPolicy(input.profile),
      notes: cursorSdkComplianceNotes(input),
    },
    warnings: input.warnings.length === 0 ? undefined : input.warnings,
    errors: input.errors,
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

function workerStatusForCursorSdk(
  commandResult: CommandResult,
  parsed: ParsedCursorStream,
  output: string,
): WorkerResult["status"] {
  if (commandResult.timedOut === true) {
    return "timeout";
  }
  if (commandResult.exitCode !== 0) {
    return "error";
  }
  if (parsed.result.resultIsError) {
    return "error";
  }
  return output.length > 0 ? "ok" : "error";
}

function cursorSdkErrors(
  commandResult: CommandResult,
  parsed: ParsedCursorStream,
  output: string,
): string[] | undefined {
  if (commandResult.timedOut === true) {
    return [`cursor SDK worker timed out after ${commandResult.durationMs}ms.`];
  }
  if (commandResult.exitCode !== 0) {
    return [
      `cursor-agent exited with code ${commandResult.exitCode}: ${snippet(commandResult.stderr || parsed.result.nonJsonLines.join("\n") || commandResult.stdout)}`,
    ];
  }
  if (parsed.result.resultIsError) {
    return ["cursor-agent stream-json result reported an error."];
  }
  if (output.length === 0) {
    return ["cursor-agent exited successfully but returned no worker output."];
  }
  return undefined;
}

function cursorSdkWarnings(
  request: WorkerRequest,
  profile: CursorExecutionProfile,
  tools: CursorToolObservation[],
  nonJsonLines: string[],
  unknownEventTypes: string[],
): string[] {
  const warnings = unmappedPreferenceWarnings("cursor", request);
  const deniedCount = tools.filter((tool) => isDeniedToolStatus(tool.status)).length;
  if (deniedCount > 0) {
    warnings.push(
      `Cursor reported ${deniedCount} denied tool result${deniedCount === 1 ? "" : "s"}.`,
    );
  }
  if (nonJsonLines.length > 0) {
    warnings.push(
      `Cursor stream-json included ${nonJsonLines.length} non-JSON line${nonJsonLines.length === 1 ? "" : "s"}.`,
    );
  }
  if (unknownEventTypes.length > 0) {
    warnings.push(
      `Cursor stream-json included unrecognized event types: ${unknownEventTypes.join(", ")}.`,
    );
  }
  warnings.push(...cursorStandingGapWarnings(profile));
  return warnings;
}

function cursorSdkComplianceNotes(input: {
  request: WorkerRequest;
  profile: CursorExecutionProfile;
  sessionId?: string;
  permissionMode?: string;
  cwd?: string;
  requestId?: string;
  requestedModelId?: string;
  modelDisplayName?: string;
  tools: CursorToolObservation[];
  nonJsonLines: string[];
  warnings: string[];
}): string[] {
  const notes = [
    "Cursor SDK adapter spawned cursor-agent --print --output-format stream-json with a run-scoped CURSOR_CONFIG_DIR.",
    `Cursor execution profile: ${input.profile}.`,
  ];
  if (input.profile === "worker") {
    notes.push("Cursor worker profile used --trust --force.");
  } else {
    notes.push("Cursor judge profile used --trust without --force.");
  }
  if (input.requestedModelId !== undefined) {
    notes.push(`Cursor requested model id: ${input.requestedModelId}.`);
  }
  if (input.modelDisplayName !== undefined) {
    notes.push(`Cursor observed model display name: ${input.modelDisplayName}.`);
  }
  if (input.sessionId !== undefined) {
    notes.push(`Cursor fresh session id observed: ${input.sessionId}.`);
  }
  if (input.permissionMode !== undefined) {
    notes.push(`Cursor init permissionMode: ${input.permissionMode}.`);
  }
  if (input.cwd !== undefined) {
    notes.push(`Cursor init cwd: ${input.cwd}.`);
  }
  if (input.requestId !== undefined) {
    notes.push(`Cursor result request_id: ${input.requestId}.`);
  }
  for (const root of input.request.environment?.readRoots ?? []) {
    notes.push(`Cursor read root passed through --add-dir: ${root}.`);
  }
  for (const tool of input.tools) {
    notes.push(
      `Cursor tool ${tool.tool} ended with status ${tool.status}${tool.detail === undefined ? "" : `: ${tool.detail}`}.`,
    );
  }
  for (const line of input.nonJsonLines) {
    notes.push(`Cursor non-JSON stream line: ${line}`);
  }
  notes.push(...cursorStandingGapNotes(input.profile));
  notes.push(...input.warnings);
  return notes;
}

function cursorStandingGapWarnings(
  profile: CursorExecutionProfile,
): string[] {
  return [
    "Cursor cannot enforce recursive delegation denial because Task is not deniable; compliance is degraded.",
    "Cursor reads are open by default, so ADR 0029 read-root semantics are not reproducible; compliance is degraded.",
    profile === "worker"
      ? "Cursor worker profile enables web tools by denying shell entirely, so the ADR 0022 read-only bash allowlist is unavailable; compliance is degraded."
      : "Cursor judge read denial depends on Read(**) enforcement and remains an evidence gap unless live-verified.",
  ];
}

function cursorStandingGapNotes(profile: CursorExecutionProfile): string[] {
  return [
    "Cursor recursion denial is unenforceable: Task is not deniable by the probed permission grammar.",
    "Cursor reads are open by default; readRoots only inform --add-dir and do not recreate ADR 0029 deny-unless-declared semantics.",
    profile === "worker"
      ? "Cursor worker web-enabled profile lacks the ADR 0022 read-only bash allowlist because Shell(**) is denied to keep web tools enabled under --force."
      : "Cursor judge profile denies Read(**), but judge read-freedom remains a standing disclosure unless live verification proves the deny effective.",
    "Cursor CURSOR_CONFIG_DIR behavior is undocumented; global config merge versus replacement semantics remain unresolved.",
  ];
}

function observedCursorToolPolicy(
  profile: CursorExecutionProfile,
): ToolsPolicy {
  return profile === "judge"
    ? {
        mode: "none",
        allow: [],
        deny: judgeDenyList,
        headlessAskBehavior: "deny",
        parity: "harness-default",
      }
    : {
        mode: "read-only",
        allow: ["Read", "Grep", "Glob", "WebFetch", "WebSearch"],
        deny: workerDenyList,
        headlessAskBehavior: "deny",
        parity: "harness-default",
      };
}

function cursorToolUseSummary(
  tools: CursorToolObservation[],
): WorkerResult["toolUseSummary"] {
  if (tools.length === 0) {
    return undefined;
  }
  const completedTools = tools.filter((tool) => tool.status !== "started");
  const toolsUsed = [...new Set(tools.map((tool) => tool.tool))];
  const deniedRequests = completedTools
    .filter((tool) => isDeniedToolStatus(tool.status))
    .map((tool) =>
      tool.detail === undefined ? `${tool.tool}: ${tool.status}` : `${tool.tool}: ${tool.detail}`,
    );
  return {
    toolsUsed,
    deniedRequests: deniedRequests.length === 0 ? undefined : deniedRequests,
  };
}

function isDeniedToolStatus(status: CursorToolObservation["status"]): boolean {
  return (
    status === "rejected" ||
    status === "permissionDenied" ||
    status === "writePermissionDenied"
  );
}

function unmappedPreferenceWarnings(
  kind: string,
  request: WorkerRequest,
): string[] {
  const warnings: string[] = [];
  if (request.reasoning?.effort !== undefined) {
    warnings.push(
      `${kind} does not expose a stable CLI flag for reasoning.effort; requested ${request.reasoning.effort} was not mapped.`,
    );
  }
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

export function parseCursorStreamJson(
  stdout: string,
  requestedModelId?: string,
): ParsedCursorStream {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const parsed: CursorStreamResult = {
    output: "",
    requestedModelId,
    toolObservations: [],
    assistantTexts: [],
    nonJsonLines: [],
    unknownEventTypes: [],
    resultIsError: false,
  };

  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      parsed.nonJsonLines.push(line);
      continue;
    }
    const record = objectValue(value);
    if (record === undefined) {
      parsed.nonJsonLines.push(line);
      continue;
    }
    applyCursorStreamRecord(parsed, record);
  }

  if (parsed.output.length === 0) {
    parsed.output = parsed.assistantTexts.join("\n");
  }
  return { ok: true, result: parsed };
}

function applyCursorStreamRecord(
  parsed: CursorStreamResult,
  record: Record<string, unknown>,
): void {
  const type = stringField(record, "type");
  if (type !== undefined && !toleratedCursorEventTypes.has(type)) {
    if (!parsed.unknownEventTypes.includes(type)) {
      parsed.unknownEventTypes.push(type);
    }
  }

  if (type === "system" && record.subtype === "init") {
    parsed.sessionId = stringField(record, "session_id") ?? parsed.sessionId;
    parsed.modelDisplayName = stringField(record, "model") ?? parsed.modelDisplayName;
    parsed.permissionMode =
      stringField(record, "permissionMode") ?? parsed.permissionMode;
    parsed.cwd = stringField(record, "cwd") ?? parsed.cwd;
    return;
  }

  if (type === "assistant") {
    const text = textFromCursorContent(record.message);
    if (text !== undefined && text.length > 0) {
      parsed.assistantTexts.push(text);
    }
    return;
  }

  if (type === "tool_call") {
    applyCursorToolCall(parsed, record);
    return;
  }

  if (type !== "result") {
    return;
  }

  parsed.resultIsError = record.is_error === true;
  parsed.output = stringField(record, "result") ?? parsed.output;
  parsed.sessionId = stringField(record, "session_id") ?? parsed.sessionId;
  parsed.requestId = stringField(record, "request_id") ?? parsed.requestId;
  parsed.usage = cursorUsage(record);
}

function applyCursorToolCall(
  parsed: CursorStreamResult,
  record: Record<string, unknown>,
): void {
  const toolRecord = objectField(record, "tool_call");
  const tool = cursorToolFromRecord(toolRecord);
  if (tool === undefined) {
    return;
  }
  if (record.subtype === "started") {
    parsed.toolObservations.push({ tool: tool.name, status: "started" });
    return;
  }

  const result = cursorToolResult(tool.record);
  parsed.toolObservations.push({
    tool: tool.name,
    status: result.status,
    detail: result.detail,
  });
}

function cursorToolFromRecord(
  toolCall: Record<string, unknown> | undefined,
): { name: string; record: Record<string, unknown> } | undefined {
  if (toolCall === undefined) {
    return undefined;
  }
  for (const [key, value] of Object.entries(toolCall)) {
    if (!key.endsWith("ToolCall")) {
      continue;
    }
    const record = objectValue(value);
    if (record === undefined) {
      continue;
    }
    return { name: cursorToolName(key), record };
  }
  return undefined;
}

function cursorToolName(key: string): string {
  switch (key) {
    case "readToolCall":
      return "Read";
    case "shellToolCall":
      return "Shell";
    case "editToolCall":
      return "Write";
    case "deleteToolCall":
      return "Delete";
    case "webSearchToolCall":
      return "WebSearch";
    case "webFetchToolCall":
      return "WebFetch";
    case "mcpToolCall":
      return "Mcp";
    case "taskToolCall":
      return "Task";
    default:
      return key.replace(/ToolCall$/u, "");
  }
}

function cursorToolResult(
  toolRecord: Record<string, unknown>,
): { status: CursorToolObservation["status"]; detail?: string } {
  const result = objectField(toolRecord, "result");
  if (result === undefined) {
    return { status: "unknown" };
  }
  for (const status of [
    "success",
    "rejected",
    "permissionDenied",
    "writePermissionDenied",
    "error",
  ] as const) {
    const detailRecord = objectField(result, status);
    if (detailRecord !== undefined) {
      return { status, detail: formatCursorToolDetail(detailRecord) };
    }
  }
  return { status: "unknown", detail: formatToolInput(result) };
}

function formatCursorToolDetail(
  record: Record<string, unknown>,
): string | undefined {
  return (
    stringField(record, "error") ??
    stringField(record, "errorMessage") ??
    stringField(record, "reason") ??
    stringField(record, "message") ??
    stringField(record, "command") ??
    stringField(record, "path") ??
    stringField(record, "url") ??
    stringField(record, "agentId") ??
    formatToolInput(record)
  );
}

function cursorUsage(record: Record<string, unknown>): WorkerResult["usage"] {
  const usage = objectField(record, "usage");
  return {
    durationMs: numberField(record, "duration_ms"),
    inputTokens:
      usage === undefined
        ? undefined
        : numberField(usage, "inputTokens") ?? numberField(usage, "input_tokens"),
    outputTokens:
      usage === undefined
        ? undefined
        : numberField(usage, "outputTokens") ??
          numberField(usage, "output_tokens"),
  };
}

function textFromCursorContent(message: unknown): string | undefined {
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
