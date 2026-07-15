import { spawn } from "node:child_process";
import { deriveContainment } from "./containment";
import type {
  HarnessKind,
  ModelPreference,
  ReasoningPreference,
  ToolsPolicy,
  WorkerRequest,
  WorkerResult,
  WorkerRunner,
} from "./types";

export interface CommandExecution {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
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
  const variant = openCodeVariantForEffort(request.reasoning?.effort);
  if (variant !== undefined) {
    args.push("--variant", variant);
  }
  return [...args, request.prompt];
}

export function buildClaudeCodeArgs(request: WorkerRequest): string[] {
  const args = buildClaudeCodeBaseArgs(request);
  appendClaudeCodeReadRoots(args, request);
  return [...args, "--", request.prompt];
}

export function buildClaudeCodeSdkArgs(request: WorkerRequest): string[] {
  return buildClaudeCodeArgs(request);
}

function appendClaudeCodeReadRoots(
  args: string[],
  request: WorkerRequest,
): void {
  for (const root of request.environment?.readRoots ?? []) {
    args.push("--add-dir", root);
  }
}

function buildClaudeCodeBaseArgs(request: WorkerRequest): string[] {
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
  if (request.reasoning?.effort !== undefined) {
    args.push("--effort", request.reasoning.effort);
  }
  const tools = claudeToolsForPolicy(request);
  if (tools !== undefined) {
    args.push(`--tools=${tools}`);
  }
  const allowedTools = claudeAllowedToolsForPolicy(request.toolsPolicy);
  if (allowedTools !== undefined) {
    args.push(`--allowedTools=${allowedTools}`);
  }
  const disallowedTools = claudeDisallowedToolsForPolicy(request.toolsPolicy);
  if (disallowedTools !== undefined) {
    args.push(`--disallowedTools=${disallowedTools}`);
  }
  return args;
}

export async function executeCommand(
  execution: CommandExecution,
): Promise<CommandResult> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const child = spawn(execution.command, execution.args, {
      cwd: execution.cwd,
      env:
        execution.env === undefined
          ? process.env
          : { ...process.env, ...execution.env },
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
  const parsedOutput = parseTextOutput(result.stdout);
  const output = parsedOutput.ok ? parsedOutput.output.trim() : "";
  const ok = result.exitCode === 0 && output.length > 0 && !result.timedOut;
  const warnings = workerWarnings(kind, request, ok);

  return {
    panelRunId: request.panelRunId,
    workerId: request.workerId,
    status: workerStatusForCliResult(result, parsedOutput, output),
    output,
    modelUsed: modelPreferenceToModel(request.modelPreference),
    harnessUsed: { kind, invocation: "headless", transport: "cli" },
    usage: { durationMs: result.durationMs },
    complianceEvidence: {
      adapterClaimsIndependentInvocation: request.session.mode === "fresh",
      adapterClaimsIsolatedContext: request.session.mode === "fresh",
      adapterClaimsBlindness: true,
      observedSessionMode: request.session.mode,
      containment: deriveContainment(request.toolsPolicy),
      notes: adapterComplianceNotes(kind, request, warnings),
    },
    warnings: warnings.length === 0 ? undefined : warnings,
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

function adapterComplianceNotes(
  kind: HarnessKind,
  request: WorkerRequest,
  warnings: string[],
): string[] {
  const notes = [...adapterBaseComplianceNotes(kind)];
  if (request.reasoning?.effort !== undefined) {
    const mapping =
      kind === "opencode"
        ? `opencode --variant ${openCodeVariantForEffort(request.reasoning.effort)}`
        : `claude --effort ${request.reasoning.effort}`;
    notes.push(`reasoning.effort mapped through ${mapping}.`);
  }
  if (
    kind === "claude-code" &&
    request.toolsPolicy?.readOnlyBashCommands !== undefined
  ) {
    notes.push(
      "Claude Code Bash access is restricted with --allowedTools command patterns and --permission-mode dontAsk.",
    );
  }
  notes.push(...warnings);
  return notes;
}

function adapterBaseComplianceNotes(kind: HarnessKind): string[] {
  if (kind === "opencode") {
    return [
      "OpenCode CLI adapter cannot yet prove exact tool policy enforcement.",
    ];
  }

  return [
    "Claude Code CLI adapter uses dontAsk and explicit tool flags when available.",
  ];
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

function workerWarnings(
  kind: HarnessKind,
  request: WorkerRequest,
  ok: boolean,
): string[] {
  return [
    ok && kind === "opencode"
      ? "OpenCode CLI adapter result is degraded until tool policy evidence is proven."
      : undefined,
    ...unmappedPreferenceWarnings(kind, request),
  ].filter((warning): warning is string => warning !== undefined);
}

function unmappedPreferenceWarnings(
  kind: HarnessKind,
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
  if (
    kind === "opencode" &&
    request.environment?.readRoots !== undefined &&
    request.environment.readRoots.length > 0
  ) {
    warnings.push(
      `${kind} does not expose a CLI flag for environment.readRoots; requested ${request.environment.readRoots.join(", ")} was not mapped.`,
    );
  }
  return warnings;
}

function openCodeVariantForEffort(
  effort: ReasoningPreference["effort"] | undefined,
): string | undefined {
  if (effort === undefined) {
    return undefined;
  }
  return effort === "xhigh" ? "max" : effort;
}

function claudeToolsForPolicy(request: WorkerRequest): string | undefined {
  const toolsPolicy = request.toolsPolicy;
  switch (toolsPolicy?.mode) {
    case "none":
      return "";
    case "read-only":
      return withBashTool(
        toolsPolicy.allow ?? [
          "Read",
          "Grep",
          "Glob",
          "WebSearch",
          "WebFetch",
        ],
        toolsPolicy,
      );
    case "limited":
      return toolsPolicy.allow === undefined
        ? undefined
        : withBashTool(toolsPolicy.allow, toolsPolicy);
    case "full":
    case undefined:
      return undefined;
  }
}

// Scoped bash follows readOnlyBashCommands, matching the OpenCode permission
// map: an explicit "Bash" entry in allow is not required.
function withBashTool(tools: string[], toolsPolicy: ToolsPolicy): string {
  const needsBash =
    (toolsPolicy.readOnlyBashCommands?.length ?? 0) > 0 &&
    !tools.includes("Bash");
  return unique(needsBash ? [...tools, "Bash"] : tools).join(",");
}

function claudeAllowedToolsForPolicy(
  toolsPolicy: ToolsPolicy | undefined,
): string | undefined {
  if (
    toolsPolicy?.mode !== "read-only" &&
    toolsPolicy?.mode !== "limited"
  ) {
    return undefined;
  }

  const allowed = toolsPolicy.allow ?? [];
  const baseTools = allowed.filter((tool) => tool !== "Bash");
  const bashTools = (toolsPolicy.readOnlyBashCommands ?? []).map(
    claudeBashPattern,
  );
  const permissions = [...baseTools, ...bashTools];
  return permissions.length === 0 ? undefined : unique(permissions).join(",");
}

function claudeDisallowedToolsForPolicy(
  toolsPolicy: ToolsPolicy | undefined,
): string | undefined {
  const denied = toolsPolicy?.deny?.filter((tool) => tool !== "Bash") ?? [];
  return denied.length === 0 ? undefined : unique(denied).join(",");
}

function claudeBashPattern(command: string): string {
  return `Bash(${command}:*)`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
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

  const resultTexts: string[] = [];
  const assistantTexts: string[] = [];
  const fallbackTexts: string[] = [];
  for (const line of lines) {
    const parsed = extractJsonLineText(line);
    if (!parsed.ok) {
      return parsed;
    }
    if (parsed.resultText !== undefined && parsed.resultText.length > 0) {
      resultTexts.push(parsed.resultText);
    } else if (
      parsed.assistantText !== undefined &&
      parsed.assistantText.length > 0
    ) {
      assistantTexts.push(parsed.assistantText);
    } else if (
      parsed.fallbackText !== undefined &&
      parsed.fallbackText.length > 0
    ) {
      fallbackTexts.push(parsed.fallbackText);
    }
  }

  const output =
    last(resultTexts) ?? last(assistantTexts) ?? fallbackTexts.join("\n");
  if (output.length === 0) {
    return { ok: false, error: "no result text found in JSON output" };
  }
  return { ok: true, output };
}

type ExtractedJsonLineText =
  | {
      ok: true;
      resultText?: string;
      assistantText?: string;
      fallbackText?: string;
    }
  | { ok: false; error: string };

function extractJsonLineText(line: string): ExtractedJsonLineText {
  try {
    const value = JSON.parse(line) as unknown;
    if (value === null || typeof value !== "object") {
      return { ok: false, error: "JSON line is not an object" };
    }

    const record = value as Record<string, unknown>;
    if (typeof record.result === "string") {
      return { ok: true, resultText: record.result };
    }
    if (typeof record.message === "string") {
      return { ok: true, fallbackText: record.message };
    }
    if (typeof record.text === "string") {
      return { ok: true, fallbackText: record.text };
    }
    const messageText = textFromMessage(record.message);
    if (messageText !== undefined) {
      return { ok: true, assistantText: messageText };
    }
    const partText = textFromRecordPart(record.part);
    if (partText !== undefined) {
      return { ok: true, assistantText: partText };
    }
    if (Array.isArray(record.content)) {
      return {
        ok: true,
        assistantText: textFromContent(record.content),
      };
    }
  } catch {
    return { ok: false, error: "JSON line could not be parsed" };
  }
  return { ok: true };
}

function last(values: string[]): string | undefined {
  return values.length === 0 ? undefined : values[values.length - 1];
}

function textFromMessage(message: unknown): string | undefined {
  if (message === null || typeof message !== "object") {
    return undefined;
  }

  const record = message as Record<string, unknown>;
  return Array.isArray(record.content)
    ? textFromContent(record.content)
    : undefined;
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

function textFromContent(content: unknown[]): string {
  return content
    .map(textFromContentPart)
    .filter((part): part is string => part !== undefined)
    .join("\n");
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
