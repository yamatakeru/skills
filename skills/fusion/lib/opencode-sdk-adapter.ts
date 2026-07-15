import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import type { AssistantMessage, Permission } from "@opencode-ai/sdk/client";
import {
  executeCommand,
  modelPreferenceToModel,
  snippet,
  type CommandExecutor,
} from "./headless-cli-adapters";
import type {
  ToolsPolicy,
  WorkerEnvironment,
  WorkerRequest,
  WorkerResult,
  WorkerRunner,
} from "./types";

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type PermissionDecision = "ask" | "allow" | "deny";
type PermissionMap = Record<string, PermissionDecision>;

export interface OpenCodeSdkAdapterOptions {
  command?: string;
  baseUrl?: string;
  fetch?: Fetch;
  serverFactory?: OpenCodeServerFactory;
  versionExecutor?: CommandExecutor;
  agentName?: string;
}

export interface OpenCodeServerHandle {
  baseUrl: string;
  dispose(): Promise<void> | void;
}

export interface OpenCodeServerFactoryInput {
  command: string;
  configContent: OpenCodeConfigContent;
  cwd?: string;
  fetch: Fetch;
}

export type OpenCodeServerFactory = (
  input: OpenCodeServerFactoryInput,
) => Promise<OpenCodeServerHandle>;

export interface OpenCodeConfigContent {
  agent: Record<string, OpenCodeAgentConfig>;
  experimental: {
    continue_loop_on_deny: true;
  };
}

export interface OpenCodeAgentConfig {
  description: string;
  mode: "primary";
  tools: Record<string, boolean>;
  permission: OpenCodePermissionConfig;
}

export type OpenCodePermissionConfig = Record<
  string,
  PermissionDecision | PermissionMap
>;

interface OpenCodeObservation {
  output: string;
  modelUsed?: string;
  usage?: WorkerResult["usage"];
  tools: OpenCodeToolObservation[];
  permissionRejects: string[];
  warnings: string[];
}

interface OpenCodeToolObservation {
  tool: string;
  status: string;
}

interface OpenCodePermissionRule {
  permission: string;
  pattern: string;
  action: PermissionDecision;
}

interface OpenCodeAgentInfo {
  name: string;
  permission: OpenCodePermissionRule[];
}

class OpenCodeEffectiveRulesError extends Error {}

interface SseMessage {
  event?: string;
  data: string;
}

const defaultAgentName = "fusion-worker";
const sessionAbortTimeoutMs = 5_000;
const knownOpenCodeTools = [
  "read",
  "grep",
  "glob",
  "list",
  "webfetch",
  "websearch",
  "bash",
  "edit",
  "write",
  "patch",
  "task",
  "todowrite",
  "skill",
  "lsp",
  "doom_loop",
];

export class OpenCodeSdkAdapter implements WorkerRunner {
  private readonly command: string;
  private readonly fetch: Fetch;
  private readonly serverFactory: OpenCodeServerFactory;
  private readonly versionExecutor: CommandExecutor;
  private readonly agentName: string;
  private readonly injectedBaseUrl?: string;
  private serverPromise?: Promise<OpenCodeServerHandle>;
  private serverVerificationPromise?: Promise<void>;
  private versionPromise?: Promise<string | undefined>;

  constructor(options: OpenCodeSdkAdapterOptions = {}) {
    this.command = options.command ?? "opencode";
    this.fetch = options.fetch ?? fetch;
    this.serverFactory = options.serverFactory ?? spawnOpenCodeServer;
    this.versionExecutor = options.versionExecutor ?? executeCommand;
    this.agentName = options.agentName ?? defaultAgentName;
    this.injectedBaseUrl = options.baseUrl;
  }

  async runWorker(request: WorkerRequest): Promise<WorkerResult> {
    const startedAt = Date.now();
    let sessionId: string | undefined;
    const warnings: string[] = [];

    try {
      const server = await this.ensureServer(request);
      const version = await this.opencodeVersion();
      const session = await this.createSession(server.baseUrl, request);
      sessionId = session.id;
      const observation = await this.sendPromptAndObserve(
        server.baseUrl,
        request,
        session.id,
        warnings,
      );
      warnings.push(...observation.warnings);
      return openCodeWorkerResult({
        request,
        status: observation.output.trim().length === 0 ? "error" : "ok",
        output: observation.output.trim(),
        sessionId,
        modelUsed: observation.modelUsed,
        usage: {
          durationMs: Date.now() - startedAt,
          ...withoutDuration(observation.usage),
        },
        warnings,
        version,
        tools: observation.tools,
        permissionRejects: observation.permissionRejects,
        errors:
          observation.output.trim().length === 0
            ? ["opencode SDK worker returned no final assistant text."]
            : undefined,
      });
    } catch (error) {
      const message =
        error instanceof WorkerTimeoutError ||
        error instanceof OpenCodeEffectiveRulesError
          ? error.message
          : snippet(String(error));
      return openCodeWorkerResult({
        request,
        status: error instanceof WorkerTimeoutError ? "timeout" : "error",
        output: "",
        sessionId,
        usage: { durationMs: Date.now() - startedAt },
        warnings,
        version: await this.opencodeVersion().catch(() => undefined),
        tools: [],
        permissionRejects: [],
        errors: [message],
      });
    }
  }

  async dispose(): Promise<void> {
    const server = await this.serverPromise?.catch(() => undefined);
    await server?.dispose();
  }

  private async ensureServer(request: WorkerRequest): Promise<OpenCodeServerHandle> {
    if (this.injectedBaseUrl !== undefined) {
      return {
        baseUrl: this.injectedBaseUrl,
        dispose() {},
      };
    }
    if (this.serverPromise === undefined) {
      const promise = this.serverFactory({
        command: this.command,
        configContent: buildOpenCodeConfigContent({
          toolsPolicy: request.toolsPolicy,
          environment: request.environment,
          agentName: this.agentName,
        }),
        cwd:
          request.environment?.workingDirectory ??
          request.environment?.workspaceRoot,
        fetch: this.fetch,
      });
      promise.catch(() => {
        if (this.serverPromise === promise) {
          this.serverPromise = undefined;
          this.serverVerificationPromise = undefined;
        }
      });
      this.serverPromise = promise;
    }
    const server = await this.serverPromise;
    this.serverVerificationPromise ??= verifyOpenCodeEffectiveRules({
      fetch: this.fetch,
      baseUrl: server.baseUrl,
      agentName: this.agentName,
      toolsPolicy: request.toolsPolicy,
      environment: request.environment,
    });
    await this.serverVerificationPromise;
    return server;
  }

  private async opencodeVersion(): Promise<string | undefined> {
    this.versionPromise ??= this.versionExecutor({
      command: this.command,
      args: ["--version"],
    }).then((result) => versionFromOutput(`${result.stdout}\n${result.stderr}`));
    return this.versionPromise;
  }

  private async createSession(
    baseUrl: string,
    request: WorkerRequest,
  ): Promise<{ id: string }> {
    const value = await requestJson<Record<string, unknown>>(
      this.fetch,
      baseUrl,
      "/session",
      {
        method: "POST",
        body: {
          title: `Fusion ${request.workerId}`,
        },
      },
      request.environment,
    );
    const id = stringField(value, "id") ?? stringField(value, "sessionID");
    if (id === undefined) {
      throw new Error("opencode session creation returned no session id.");
    }
    return { id };
  }

  private async sendPromptAndObserve(
    baseUrl: string,
    request: WorkerRequest,
    sessionId: string,
    warnings: string[],
  ): Promise<OpenCodeObservation> {
    const messageId = `msg_${randomUUID().replace(/-/gu, "")}`;
    const controller = new AbortController();
    const observer = observeOpenCodeEvents({
      fetch: this.fetch,
      baseUrl,
      request,
      sessionId,
      messageId,
      signal: controller.signal,
      warnings,
    });
    try {
      await withTimeout(
        observer.ready,
        request.budget?.timeoutMs,
        "opencode SDK worker timed out opening SSE stream.",
      );
      const promptPromise = this.promptAsyncOrSync(
        baseUrl,
        request,
        sessionId,
        messageId,
        warnings,
        controller.signal,
      );
      promptPromise.catch(() => undefined);
      const syncObservation = await withTimeout(
        promptPromise,
        request.budget?.timeoutMs,
        "opencode SDK worker timed out sending the prompt.",
      );
      if (syncObservation !== undefined) {
        return syncObservation;
      }
      return await withTimeout(
        observer.observation,
        request.budget?.timeoutMs,
        "opencode SDK worker timed out waiting for SSE completion.",
      );
    } finally {
      await this.abortSession(baseUrl, request, sessionId, warnings);
      controller.abort();
      observer.observation.catch(() => undefined);
    }
  }

  private async abortSession(
    baseUrl: string,
    request: WorkerRequest,
    sessionId: string,
    warnings: string[],
  ): Promise<void> {
    const controller = new AbortController();
    try {
      await withTimeout(
        requestJson<boolean>(
          this.fetch,
          baseUrl,
          `/session/${encodeURIComponent(sessionId)}/abort`,
          { method: "POST", signal: controller.signal },
          request.environment,
        ),
        sessionAbortTimeoutMs,
        "opencode SDK session abort timed out.",
      );
    } catch (error) {
      warnings.push(
        `OpenCode session abort failed; session may linger until server shutdown: ${snippet(String(error))}`,
      );
    } finally {
      controller.abort();
    }
  }

  private async promptAsyncOrSync(
    baseUrl: string,
    request: WorkerRequest,
    sessionId: string,
    messageId: string,
    warnings: string[],
    signal?: AbortSignal,
  ): Promise<OpenCodeObservation | undefined> {
    const body = openCodePromptBody(request, messageId, this.agentName, warnings);
    try {
      await requestJson<void>(
        this.fetch,
        baseUrl,
        `/session/${encodeURIComponent(sessionId)}/prompt_async`,
        {
          method: "POST",
          body,
          signal,
        },
        request.environment,
      );
      return undefined;
    } catch (error) {
      if (!(error instanceof HttpError) || (error.status !== 404 && error.status !== 405)) {
        throw error;
      }
    }

    const value = await requestJson<Record<string, unknown>>(
      this.fetch,
      baseUrl,
      `/session/${encodeURIComponent(sessionId)}/message`,
      {
        method: "POST",
        body,
        signal,
      },
      request.environment,
    );
    return observationFromPromptResponse(value);
  }
}

function openCodeWorkerResult(input: {
  request: WorkerRequest;
  status: WorkerResult["status"];
  output: string;
  sessionId?: string;
  modelUsed?: string;
  usage?: WorkerResult["usage"];
  warnings: string[];
  version?: string;
  tools: OpenCodeToolObservation[];
  permissionRejects: string[];
  errors?: string[];
}): WorkerResult {
  return {
    panelRunId: input.request.panelRunId,
    workerId: input.request.workerId,
    status: input.status,
    output: input.output,
    modelUsed: input.modelUsed,
    harnessUsed: {
      kind: "opencode",
      invocation: "headless",
      transport: "sdk",
      version: input.version,
    },
    sessionId: input.sessionId,
    toolUseSummary: toolUseSummary(input.tools, input.permissionRejects),
    usage: input.usage,
    complianceEvidence: {
      adapterClaimsIndependentInvocation:
        input.request.session.mode === "fresh" && input.sessionId !== undefined,
      adapterClaimsIsolatedContext:
        input.request.session.mode === "fresh" && input.sessionId !== undefined,
      adapterClaimsBlindness: true,
      observedSessionMode: input.request.session.mode,
      observedToolPolicy: input.request.toolsPolicy,
      notes: openCodeComplianceNotes(input),
    },
    warnings: input.warnings.length === 0 ? undefined : input.warnings,
    errors: input.errors,
  };
}

function openCodeComplianceNotes(input: {
  request: WorkerRequest;
  sessionId?: string;
  version?: string;
  tools: OpenCodeToolObservation[];
  permissionRejects: string[];
  warnings: string[];
}): string[] {
  const notes = [
    "OpenCode SDK adapter applied tool policy through OPENCODE_CONFIG_CONTENT and per-session permission pre-decision.",
    "OpenCode merges the injected policy with user-level config; effective permissions can be wider than the declared policy.",
  ];
  if (input.version !== undefined) {
    notes.push(`OpenCode binary version: ${input.version}.`);
  }
  if (input.sessionId !== undefined) {
    notes.push(`OpenCode fresh session id observed: ${input.sessionId}.`);
  }
  for (const tool of input.tools) {
    notes.push(`OpenCode tool ${tool.tool} ended with status ${tool.status}.`);
  }
  for (const reject of input.permissionRejects) {
    notes.push(`OpenCode unexpected permission ask auto-rejected: ${reject}.`);
  }
  notes.push(...input.warnings);
  return notes;
}

function toolUseSummary(
  tools: OpenCodeToolObservation[],
  permissionRejects: string[],
): WorkerResult["toolUseSummary"] {
  if (tools.length === 0 && permissionRejects.length === 0) {
    return undefined;
  }
  return {
    toolsUsed:
      tools.length === 0
        ? undefined
        : [...new Set(tools.map((tool) => tool.tool))],
    deniedRequests:
      permissionRejects.length === 0 ? undefined : permissionRejects,
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

export function buildOpenCodeConfigContent(input: {
  toolsPolicy: ToolsPolicy | undefined;
  environment: WorkerEnvironment | undefined;
  agentName?: string;
}): OpenCodeConfigContent {
  const agentName = input.agentName ?? defaultAgentName;
  return {
    agent: {
      [agentName]: {
        description: "Fusion read-only worker",
        mode: "primary",
        tools: openCodeToolsForPolicy(input.toolsPolicy),
        permission: buildOpenCodePermissionMap(
          input.toolsPolicy,
          input.environment,
        ),
      },
    },
    experimental: {
      continue_loop_on_deny: true,
    },
  };
}

export function buildOpenCodePermissionMap(
  toolsPolicy: ToolsPolicy | undefined,
  environment: WorkerEnvironment | undefined,
): OpenCodePermissionConfig {
  const allowedTools = allowedOpenCodeTools(toolsPolicy);
  return {
    // OpenCode permission evaluation is last-match-wins, so specific rules
    // must retain insertion order after this deny-by-default rule.
    "*": "deny",
    read: "allow",
    grep: "allow",
    glob: "allow",
    list: "allow",
    edit: allowedTools.has("edit") ? "allow" : "deny",
    write: "deny",
    patch: "deny",
    task: "deny",
    todowrite: "deny",
    skill: "deny",
    lsp: "deny",
    doom_loop: "deny",
    webfetch: allowedTools.has("webfetch") ? "allow" : "deny",
    websearch: allowedTools.has("websearch") ? "allow" : "deny",
    bash: bashPermissionMap(toolsPolicy),
    external_directory: externalDirectoryPermissionMap(environment?.readRoots),
  };
}

async function verifyOpenCodeEffectiveRules(input: {
  fetch: Fetch;
  baseUrl: string;
  agentName: string;
  toolsPolicy: ToolsPolicy | undefined;
  environment: WorkerEnvironment | undefined;
}): Promise<void> {
  const value = await requestJson<unknown>(
    input.fetch,
    input.baseUrl,
    "/agent",
    { method: "GET" },
    input.environment,
  );
  const agents = openCodeAgentInfos(value);
  const agent = agents.find((candidate) => candidate.name === input.agentName);
  const expected = expectedOpenCodePermissionRules(input.toolsPolicy);
  const missing =
    agent === undefined
      ? expected
      : expected.filter(
          (rule) =>
            !agent.permission.some(
              (observed) =>
                observed.permission === rule.permission &&
                observed.pattern === rule.pattern &&
                observed.action === rule.action,
            ),
        );
  if (agent !== undefined && missing.length === 0) {
    return;
  }

  const relevantPermissions = new Set(expected.map((rule) => rule.permission));
  throw new OpenCodeEffectiveRulesError(
    `OpenCode effective permission verification failed: ${JSON.stringify({
      code: "OPENCODE_EFFECTIVE_RULES_MISMATCH",
      agent: input.agentName,
      expected,
      observed:
        agent === undefined
          ? { availableAgents: agents.map((candidate) => candidate.name) }
          : {
              rules: agent.permission.filter((rule) =>
                relevantPermissions.has(rule.permission),
              ),
            },
      missing,
    })}`,
  );
}

function expectedOpenCodePermissionRules(
  toolsPolicy: ToolsPolicy | undefined,
): OpenCodePermissionRule[] {
  const permission = buildOpenCodePermissionMap(toolsPolicy, undefined);
  const expected: OpenCodePermissionRule[] = [
    { permission: "*", pattern: "*", action: "deny" },
    { permission: "bash", pattern: "*", action: "deny" },
    { permission: "read", pattern: "*", action: "allow" },
    { permission: "grep", pattern: "*", action: "allow" },
    { permission: "glob", pattern: "*", action: "allow" },
    {
      permission: "webfetch",
      pattern: "*",
      action: permission.webfetch as PermissionDecision,
    },
    {
      permission: "websearch",
      pattern: "*",
      action: permission.websearch as PermissionDecision,
    },
  ];
  for (const command of toolsPolicy?.readOnlyBashCommands ?? []) {
    expected.push(
      { permission: "bash", pattern: command, action: "allow" },
      { permission: "bash", pattern: `${command} *`, action: "allow" },
    );
  }
  return expected;
}

function openCodeAgentInfos(value: unknown): OpenCodeAgentInfo[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    const record = objectValue(candidate);
    const name = record === undefined ? undefined : stringField(record, "name");
    if (
      record === undefined ||
      name === undefined ||
      !Array.isArray(record.permission)
    ) {
      return [];
    }
    const permission: OpenCodePermissionRule[] = record.permission.flatMap(
      (candidateRule) => {
        const rule = objectValue(candidateRule);
        const permissionId =
          rule === undefined ? undefined : stringField(rule, "permission");
        const pattern =
          rule === undefined ? undefined : stringField(rule, "pattern");
        const action =
          rule === undefined ? undefined : stringField(rule, "action");
        if (
          permissionId === undefined ||
          pattern === undefined ||
          (action !== "ask" && action !== "allow" && action !== "deny")
        ) {
          return [];
        }
        return [
          {
            permission: permissionId,
            pattern,
            action: action as PermissionDecision,
          },
        ];
      },
    );
    return [{ name, permission }];
  });
}

export function openCodeToolsForPolicy(
  toolsPolicy: ToolsPolicy | undefined,
): Record<string, boolean> {
  const allowedTools = allowedOpenCodeTools(toolsPolicy);
  const deniedTools = deniedOpenCodeTools(toolsPolicy);
  return Object.fromEntries(
    knownOpenCodeTools.map((tool) => [
      tool,
      allowedTools.has(tool) && !deniedTools.has(tool),
    ]),
  );
}

function allowedOpenCodeTools(
  toolsPolicy: ToolsPolicy | undefined,
): Set<string> {
  switch (toolsPolicy?.mode) {
    case "none":
      return new Set();
    case "read-only":
      return new Set(
        (toolsPolicy.allow ?? [
          "Read",
          "Grep",
          "Glob",
          "LS",
          "WebFetch",
          "WebSearch",
          "Bash",
        ]).flatMap(openCodeToolIds),
      );
    case "limited":
      return new Set((toolsPolicy.allow ?? []).flatMap(openCodeToolIds));
    case "full":
      return new Set(knownOpenCodeTools);
    case undefined:
      return new Set(["read", "grep", "glob", "list", "webfetch", "websearch", "bash"]);
  }
}

function deniedOpenCodeTools(
  toolsPolicy: ToolsPolicy | undefined,
): Set<string> {
  return new Set((toolsPolicy?.deny ?? []).flatMap(openCodeToolIds));
}

function openCodeToolIds(tool: string): string[] {
  const normalized = tool.toLowerCase();
  switch (normalized) {
    case "read":
      return ["read"];
    case "grep":
      return ["grep"];
    case "glob":
      return ["glob"];
    case "ls":
    case "list":
      return ["list"];
    case "webfetch":
    case "web-fetch":
      return ["webfetch"];
    case "websearch":
    case "web-search":
      return ["websearch"];
    case "bash":
      return ["bash"];
    case "write":
      return ["write"];
    case "edit":
    case "multiedit":
    case "notebookedit":
      return ["edit"];
    case "task":
      return ["task"];
    case "todowrite":
      return ["todowrite"];
    default:
      return [normalized];
  }
}

function bashPermissionMap(
  toolsPolicy: ToolsPolicy | undefined,
): PermissionMap {
  if (toolsPolicy?.mode === "full") {
    return { "*": "allow" };
  }
  const map: PermissionMap = { "*": "deny" };
  if (toolsPolicy?.mode === "none") {
    return map;
  }
  for (const command of toolsPolicy?.readOnlyBashCommands ?? []) {
    map[command] = "allow";
    map[`${command} *`] = "allow";
  }
  return map;
}

function externalDirectoryPermissionMap(
  readRoots: string[] | undefined,
): PermissionMap {
  const map: PermissionMap = { "*": "deny" };
  for (const root of readRoots ?? []) {
    const normalized = normalizeReadRoot(root);
    map[normalized] = "allow";
    map[`${normalized === "/" ? "" : normalized}/**`] = "allow";
  }
  return map;
}

function normalizeReadRoot(root: string): string {
  const trimmed = root.replace(/\/+$/u, "");
  return trimmed.length === 0 ? "/" : trimmed;
}

function openCodePromptBody(
  request: WorkerRequest,
  messageId: string,
  agentName: string,
  warnings: string[],
): Record<string, unknown> {
  return {
    messageID: messageId,
    model: splitOpenCodeModelPreference(request, warnings),
    agent: agentName,
    parts: [{ type: "text", text: request.prompt }],
  };
}

function splitOpenCodeModelPreference(
  request: WorkerRequest,
  warnings: string[],
): { providerID: string; modelID: string } | undefined {
  const model = modelPreferenceToModel(request.modelPreference);
  const split = splitOpenCodeModel(model);
  if (model !== undefined && split === undefined) {
    warnings.push(
      `OpenCode SDK adapter ignored model preference "${model}" because it must use provider/model format.`,
    );
  }
  return split;
}

export function splitOpenCodeModel(
  model: string | undefined,
): { providerID: string; modelID: string } | undefined {
  if (model === undefined) {
    return undefined;
  }
  const slashIndex = model.indexOf("/");
  if (slashIndex === -1) {
    return undefined;
  }
  return {
    providerID: model.slice(0, slashIndex),
    modelID: model.slice(slashIndex + 1),
  };
}

function observationFromPromptResponse(
  value: Record<string, unknown>,
): OpenCodeObservation {
  const info = objectField(value, "info");
  const parts = Array.isArray(value.parts) ? value.parts : [];
  return {
    output: textFromParts(parts),
    modelUsed: modelFromAssistantInfo(info),
    usage: usageFromAssistantInfo(info),
    tools: toolObservationsFromParts(parts),
    permissionRejects: [],
    warnings: [],
  };
}

function observeOpenCodeEvents(input: {
  fetch: Fetch;
  baseUrl: string;
  request: WorkerRequest;
  sessionId: string;
  messageId: string;
  signal: AbortSignal;
  warnings: string[];
}): {
  ready: Promise<void>;
  observation: Promise<OpenCodeObservation>;
} {
  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const observation = collectOpenCodeEvents(input, resolveReady, rejectReady);
  return { ready, observation };
}

async function collectOpenCodeEvents(
  input: {
    fetch: Fetch;
    baseUrl: string;
    request: WorkerRequest;
    sessionId: string;
    messageId: string;
    signal: AbortSignal;
    warnings: string[];
  },
  resolveReady: () => void,
  rejectReady: (error: unknown) => void,
): Promise<OpenCodeObservation> {
  const observation: OpenCodeObservation = {
    output: "",
    tools: [],
    permissionRejects: [],
    warnings: [],
  };
  const textParts = new Map<string, string>();
  let response: Response;
  try {
    response = await input.fetch(serverUrl(input.baseUrl, "/event"), {
      headers: { Accept: "text/event-stream" },
      signal: input.signal,
    });
    if (!response.ok || response.body === null) {
      throw new Error(`opencode event stream failed with HTTP ${response.status}.`);
    }
    resolveReady();
  } catch (error) {
    rejectReady(error);
    throw error;
  }

  for await (const message of readSseMessages(response.body)) {
    const record = parseSseJson(message, observation.warnings);
    if (record === undefined) {
      continue;
    }
    const outcome = await applyOpenCodeEvent({
      record,
      eventName: message.event,
      observation,
      textParts,
      input,
    });
    observation.output = [...textParts.values()].join("\n");
    if (outcome === "session-idle") {
      return observation;
    }
    if (outcome === "assistant-final" && observation.output.trim().length > 0) {
      return observation;
    }
  }

  observation.output = [...textParts.values()].join("\n");
  return observation;
}

type OpenCodeEventOutcome = "continue" | "assistant-final" | "session-idle";

async function applyOpenCodeEvent(input: {
  record: Record<string, unknown>;
  eventName?: string;
  observation: OpenCodeObservation;
  textParts: Map<string, string>;
  input: {
    fetch: Fetch;
    baseUrl: string;
    request: WorkerRequest;
    sessionId: string;
    messageId: string;
    signal: AbortSignal;
    warnings: string[];
  };
}): Promise<OpenCodeEventOutcome> {
  const type = stringField(input.record, "type") ?? input.eventName;
  const properties = objectField(input.record, "properties") ?? input.record;
  switch (type) {
    case "message.part.updated":
      applyMessagePart(
        properties,
        input.textParts,
        input.observation,
        input.input.sessionId,
        input.input.messageId,
      );
      return "continue";
    case "message.updated":
      return applyMessageUpdated(properties, input.observation, input.input)
        ? "assistant-final"
        : "continue";
    case "session.idle":
      return stringField(properties, "sessionID") === input.input.sessionId
        ? "session-idle"
        : "continue";
    case "permission.updated":
      await rejectPermissionAsk(properties, input.observation, input.input);
      return "continue";
    case "session.status":
      applySessionStatus(properties, input.input.warnings, input.input.sessionId);
      return "continue";
    case "session.error":
      input.observation.warnings.push("OpenCode session emitted an error event.");
      return "continue";
    default:
      return "continue";
  }
}

function applyMessagePart(
  properties: Record<string, unknown>,
  textParts: Map<string, string>,
  observation: OpenCodeObservation,
  sessionId: string,
  promptMessageId: string,
): void {
  const part = objectField(properties, "part");
  if (part === undefined) {
    return;
  }
  if (stringField(part, "sessionID") !== sessionId) {
    return;
  }
  if (stringField(part, "messageID") === promptMessageId) {
    return;
  }
  const partType = stringField(part, "type");
  if (partType === "text") {
    const id = stringField(part, "id");
    const text = stringField(part, "text");
    if (id !== undefined && text !== undefined) {
      textParts.set(id, text);
    }
  }
  if (partType === "tool") {
    const status = stringField(objectField(part, "state") ?? {}, "status");
    const tool = stringField(part, "tool");
    if (status !== undefined && status !== "pending" && status !== "running") {
      observation.tools.push({ tool: tool ?? "unknown", status });
      if (status === "error" && tool !== undefined) {
        observation.warnings.push(`OpenCode tool ${tool} ended with error.`);
      }
    }
  }
  if (partType === "step-finish") {
    const tokens = objectField(part, "tokens");
    observation.usage = {
      inputTokens: tokens === undefined ? undefined : numberField(tokens, "input"),
      outputTokens:
        tokens === undefined ? undefined : numberField(tokens, "output"),
      costUsd: numberField(part, "cost"),
    };
  }
}

function applySessionStatus(
  properties: Record<string, unknown>,
  warnings: string[],
  sessionId: string,
): void {
  if (stringField(properties, "sessionID") !== sessionId) {
    return;
  }
  const status = objectField(properties, "status");
  if (status === undefined || stringField(status, "type") !== "retry") {
    return;
  }
  const warning = `OpenCode provider call is retrying: ${stringField(status, "message") ?? "unknown error"}.`;
  if (!warnings.includes(warning)) {
    warnings.push(warning);
  }
}

function applyMessageUpdated(
  properties: Record<string, unknown>,
  observation: OpenCodeObservation,
  input: {
    sessionId: string;
    messageId: string;
  },
): boolean {
  const info = objectField(properties, "info") as AssistantMessage | undefined;
  if (info === undefined || info.role !== "assistant") {
    return false;
  }
  if (info.sessionID !== input.sessionId) {
    return false;
  }
  observation.modelUsed = modelFromAssistantInfo(info);
  observation.usage = usageFromAssistantInfo(info) ?? observation.usage;
  // Steps end with finish "tool-calls" (and a completed time); only a
  // finish of "stop" marks the assistant's final message of the turn.
  return info.finish === "stop";
}

async function rejectPermissionAsk(
  properties: Record<string, unknown>,
  observation: OpenCodeObservation,
  input: {
    fetch: Fetch;
    baseUrl: string;
    request: WorkerRequest;
    sessionId: string;
  },
): Promise<void> {
  const permission = permissionFromProperties(properties);
  if (permission === undefined) {
    observation.warnings.push("OpenCode emitted a permission event without an id.");
    return;
  }
  const sessionId = permission.sessionID || input.sessionId;
  observation.permissionRejects.push(permission.title || permission.type);
  observation.warnings.push(
    `OpenCode emitted an unexpected permission ask and Fusion rejected it: ${permission.title || permission.type}.`,
  );
  await requestJson<void>(
    input.fetch,
    input.baseUrl,
    `/session/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(permission.id)}`,
    {
      method: "POST",
      body: { response: "reject" },
    },
    input.request.environment,
  ).catch((error) => {
    observation.warnings.push(
      `OpenCode permission auto-reject failed: ${snippet(String(error))}`,
    );
  });
}

function permissionFromProperties(
  properties: Record<string, unknown>,
): Permission | undefined {
  const permission = objectField(properties, "permission") ?? properties;
  const id = stringField(permission, "id") ?? stringField(permission, "permissionID");
  if (id === undefined) {
    return undefined;
  }
  return {
    id,
    type: stringField(permission, "type") ?? "unknown",
    pattern: stringField(permission, "pattern"),
    sessionID: stringField(permission, "sessionID") ?? "",
    messageID: stringField(permission, "messageID") ?? "",
    callID: stringField(permission, "callID"),
    title: stringField(permission, "title") ?? id,
    metadata: objectField(permission, "metadata") ?? {},
    time: (objectField(permission, "time") as Permission["time"]) ?? {
      created: Date.now(),
    },
  };
}

async function* readSseMessages(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      yield* drainSseBuffer(buffer, (rest) => {
        buffer = rest;
      });
    }
    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      const message = parseSseBlock(buffer);
      if (message !== undefined) {
        yield message;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function* drainSseBuffer(
  buffer: string,
  update: (rest: string) => void,
): Generator<SseMessage> {
  let rest = buffer;
  while (true) {
    const normalized = rest.replace(/\r\n/gu, "\n");
    const separatorIndex = normalized.indexOf("\n\n");
    if (separatorIndex === -1) {
      update(rest);
      return;
    }
    const block = normalized.slice(0, separatorIndex);
    rest = normalized.slice(separatorIndex + 2);
    const message = parseSseBlock(block);
    if (message !== undefined) {
      yield message;
    }
  }
}

function parseSseBlock(block: string): SseMessage | undefined {
  const data: string[] = [];
  let event: string | undefined;
  for (const line of block.split(/\r?\n/u)) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    }
    if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
  }
  return data.length === 0 ? undefined : { event, data: data.join("\n") };
}

function parseSseJson(
  message: SseMessage,
  warnings: string[],
): Record<string, unknown> | undefined {
  if (message.data === "[DONE]") {
    return undefined;
  }
  try {
    const value = JSON.parse(message.data) as unknown;
    return objectValue(value);
  } catch {
    warnings.push("OpenCode SSE event could not be parsed as JSON.");
    return undefined;
  }
}

async function requestJson<T>(
  fetchImpl: Fetch,
  baseUrl: string,
  path: string,
  init: {
    method: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
  },
  environment?: WorkerEnvironment,
): Promise<T> {
  const response = await fetchImpl(serverUrl(baseUrl, path, environment), {
    method: init.method,
    headers:
      init.body === undefined
        ? undefined
        : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });
  if (!response.ok) {
    throw new HttpError(
      response.status,
      `${init.method} ${path} failed with HTTP ${response.status}: ${snippet(await response.text())}`,
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  return (text.length === 0 ? undefined : JSON.parse(text)) as T;
}

function serverUrl(
  baseUrl: string,
  path: string,
  environment?: WorkerEnvironment,
): string {
  const url = new URL(path, baseUrl);
  const directory = environment?.workingDirectory ?? environment?.workspaceRoot;
  if (directory !== undefined) {
    url.searchParams.set("directory", directory);
  }
  return url.toString();
}

async function spawnOpenCodeServer(
  input: OpenCodeServerFactoryInput,
): Promise<OpenCodeServerHandle> {
  try {
    return await spawnOpenCodeServerOnce(input);
  } catch {
    return spawnOpenCodeServerOnce(input);
  }
}

async function spawnOpenCodeServerOnce(
  input: OpenCodeServerFactoryInput,
): Promise<OpenCodeServerHandle> {
  const port = await pickFreePort();
  const child = spawn(input.command, [
    "serve",
    "--hostname=127.0.0.1",
    `--port=${port}`,
  ], {
    cwd: input.cwd,
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(input.configContent),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => output.push(chunk));
  const baseUrl = `http://127.0.0.1:${port}`;

  // Without an "error" listener, a failed spawn (e.g. missing binary) is an
  // unhandled EventEmitter error that crashes the whole process.
  const spawnFailure = new Promise<never>((_, reject) => {
    child.once("error", (error) => {
      reject(
        new Error(`opencode serve failed to spawn: ${error.message}`),
      );
    });
  });
  spawnFailure.catch(() => undefined);

  await Promise.race([
    waitForOpenCodeServer(child, baseUrl, input.fetch, output),
    spawnFailure,
  ]);
  return {
    baseUrl,
    dispose: () => terminateChild(child),
  };
}

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a localhost port."));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForOpenCodeServer(
  child: ChildProcess,
  baseUrl: string,
  fetchImpl: Fetch,
  output: Buffer[],
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `opencode serve exited before becoming ready: ${snippet(Buffer.concat(output).toString("utf8"))}`,
      );
    }
    try {
      const response = await fetchImpl(serverUrl(baseUrl, "/session"), {
        method: "GET",
      });
      if (response.status < 500) {
        return;
      }
    } catch {
    }
    await sleep(100);
  }
  await terminateChild(child);
  throw new Error("opencode serve did not become ready within 30000ms.");
}

async function terminateChild(
  child: ChildProcess,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const closed = new Promise<void>((resolve) => {
    child.once("close", () => resolve());
  });
  child.kill("SIGTERM");
  const terminated = await settleWithin(closed, 1_000);
  if (!terminated && child.exitCode === null) {
    child.kill("SIGKILL");
    await settleWithin(closed, 1_000);
  }
}

async function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function modelFromAssistantInfo(
  info: Record<string, unknown> | AssistantMessage | undefined,
): string | undefined {
  if (info === undefined) {
    return undefined;
  }
  const record = objectValue(info);
  if (record === undefined) {
    return undefined;
  }
  const providerID = stringField(record, "providerID");
  const modelID = stringField(record, "modelID");
  return providerID !== undefined && modelID !== undefined
    ? `${providerID}/${modelID}`
    : undefined;
}

function usageFromAssistantInfo(
  info: Record<string, unknown> | AssistantMessage | undefined,
): WorkerResult["usage"] {
  if (info === undefined) {
    return undefined;
  }
  const record = objectValue(info);
  if (record === undefined) {
    return undefined;
  }
  const tokens = objectField(record, "tokens");
  return {
    inputTokens: tokens === undefined ? undefined : numberField(tokens, "input"),
    outputTokens:
      tokens === undefined ? undefined : numberField(tokens, "output"),
    costUsd: numberField(record, "cost"),
  };
}

function textFromParts(parts: unknown[]): string {
  return parts
    .map((part) => {
      const record = objectValue(part);
      return record?.type === "text" ? stringField(record, "text") : undefined;
    })
    .filter((text): text is string => text !== undefined)
    .join("\n");
}

function toolObservationsFromParts(parts: unknown[]): OpenCodeToolObservation[] {
  return parts
    .map((part): OpenCodeToolObservation | undefined => {
      const record = objectValue(part);
      if (record?.type !== "tool") {
        return undefined;
      }
      const state = objectField(record, "state");
      const status = state === undefined ? undefined : stringField(state, "status");
      const tool = stringField(record, "tool");
      return tool !== undefined && status !== undefined
        ? { tool, status }
        : undefined;
    })
    .filter((tool): tool is OpenCodeToolObservation => tool !== undefined);
}

function versionFromOutput(output: string): string | undefined {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => /^\d+\.\d+\.\d+(?:[-+].*)?$/u.test(line));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  message: string,
): Promise<T> {
  if (timeoutMs === undefined) {
    return promise;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WorkerTimeoutError(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
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

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

class WorkerTimeoutError extends Error {}
