import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import type { AssistantMessage, Permission } from "@opencode-ai/sdk/client";
import { deriveContainment } from "./containment";
import {
  executeCommand,
  modelPreferenceToModel,
  snippet,
  type CommandExecutor,
} from "./headless-cli-adapters";
import type {
  ToolsPolicy,
  WorkerAbortOutcome,
  WorkerEnvironment,
  WorkerRequest,
  WorkerResult,
  WorkerRunner,
} from "./types";
import { fusionPanelDepthEnv, nextFusionPanelDepth } from "./panel-depth";

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
  env: Record<string, string>;
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
  permissionRejects: OpenCodePermissionRejectObservation[];
  warnings: string[];
}

interface OpenCodeToolObservation {
  tool: string;
  status: string;
  command?: string;
  callId?: string;
}

interface OpenCodePermissionRejectObservation {
  title: string;
  callId?: string;
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
class OpenCodeSharedServerPolicyError extends Error {}

interface SseMessage {
  event?: string;
  data: string;
}

const defaultAgentName = "fusion-worker";
const judgeAgentName = "fusion-judge";
// OpenCode v1.17.20 PermissionV1.DeniedError, RejectedError, and
// CorrectedError messages from packages/core/src/v1/permission.ts.
const openCodePermissionDenialErrorPrefixes = [
  "The user has specified a rule which prevents you from using this specific tool call",
  "The user rejected permission to use this specific tool call",
] as const;
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

function openCodeAgentName(
  request: WorkerRequest,
  workerAgentName: string,
): string {
  return request.toolsPolicy?.mode === "none"
    ? judgeAgentName
    : workerAgentName;
}

function canonicalOpenCodePolicyFingerprint(
  toolsPolicy: ToolsPolicy | undefined,
  environment: WorkerEnvironment | undefined,
): string {
  return JSON.stringify({
    toolsPolicy:
      toolsPolicy === undefined
        ? null
        : {
            mode: toolsPolicy.mode,
            allow: toolsPolicy.allow,
            deny: toolsPolicy.deny,
            readOnlyBashCommands: toolsPolicy.readOnlyBashCommands,
          },
    readRoots: environment?.readRoots ?? null,
  });
}

export class OpenCodeSdkAdapter implements WorkerRunner {
  private readonly command: string;
  private readonly fetch: Fetch;
  private readonly serverFactory: OpenCodeServerFactory;
  private readonly versionExecutor: CommandExecutor;
  private readonly agentName: string;
  private readonly injectedBaseUrl?: string;
  private serverPromise?: Promise<OpenCodeServerHandle>;
  private serverVerificationPromise?: Promise<
    Map<string, OpenCodePermissionRule[]>
  >;
  private serverEffectiveRules?: {
    baseUrl: string;
    rulesByAgent: Map<string, OpenCodePermissionRule[]>;
  };
  private serverPolicyFingerprint?: string;
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
    let effectiveRules: OpenCodePermissionRule[] | undefined;
    const abortOutcome: WorkerAbortOutcome = { attempted: false };
    const warnings: string[] = [];

    try {
      const server = await this.ensureServer(request);
      const selectedAgentName = openCodeAgentName(request, this.agentName);
      effectiveRules =
        this.serverEffectiveRules?.baseUrl === server.baseUrl
          ? this.serverEffectiveRules.rulesByAgent.get(selectedAgentName)
          : undefined;
      const version = await this.opencodeVersion();
      const session = await this.createSession(server.baseUrl, request);
      sessionId = session.id;
      const observation = await this.sendPromptAndObserve(
        server.baseUrl,
        request,
        session.id,
        warnings,
        abortOutcome,
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
        effectiveRules,
        abortOutcome,
        errors:
          observation.output.trim().length === 0
            ? ["opencode SDK worker returned no final assistant text."]
            : undefined,
      });
    } catch (error) {
      const message =
        error instanceof WorkerTimeoutError ||
        error instanceof OpenCodeEffectiveRulesError ||
        error instanceof OpenCodeSharedServerPolicyError
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
        effectiveRules,
        abortOutcome,
        errors: [message],
      });
    }
  }

  async dispose(): Promise<void> {
    const server = await this.serverPromise?.catch(() => undefined);
    await server?.dispose();
  }

  private async ensureServer(request: WorkerRequest): Promise<OpenCodeServerHandle> {
    const requestPolicyFingerprint = canonicalOpenCodePolicyFingerprint(
      request.toolsPolicy,
      request.environment,
    );
    if (this.serverPromise === undefined) {
      this.serverPolicyFingerprint = requestPolicyFingerprint;
      const promise =
        this.injectedBaseUrl === undefined
          ? this.serverFactory({
              command: this.command,
              configContent: buildOpenCodeConfigContent({
                toolsPolicy: request.toolsPolicy,
                environment: request.environment,
                agentName: this.agentName,
              }),
              cwd:
                request.environment?.workingDirectory ??
                request.environment?.workspaceRoot,
              env: { [fusionPanelDepthEnv]: nextFusionPanelDepth() },
              fetch: this.fetch,
            })
          : Promise.resolve({
              baseUrl: this.injectedBaseUrl,
              dispose() {},
            });
      promise.catch(() => {
        if (this.serverPromise === promise) {
          this.serverPromise = undefined;
          this.serverVerificationPromise = undefined;
          this.serverEffectiveRules = undefined;
          this.serverPolicyFingerprint = undefined;
        }
      });
      this.serverPromise = promise;
    } else if (
      request.toolsPolicy?.mode !== "none" &&
      this.serverPolicyFingerprint !== requestPolicyFingerprint
    ) {
      throw new OpenCodeSharedServerPolicyError(
        `OpenCode shared-server tools policy mismatch: ${JSON.stringify({
          code: "OPENCODE_SHARED_SERVER_POLICY_MISMATCH",
          configuredPolicy: JSON.parse(
            this.serverPolicyFingerprint ?? "null",
          ),
          requestPolicy: JSON.parse(requestPolicyFingerprint),
        })}`,
      );
    }
    const server = await this.serverPromise;
    // Fingerprint equality preserves expected environment rules; judge rules are invariant.
    this.serverVerificationPromise ??= verifyOpenCodeEffectiveRules({
      fetch: this.fetch,
      baseUrl: server.baseUrl,
      agentName: this.agentName,
      toolsPolicy: request.toolsPolicy,
      environment: request.environment,
    });
    const rulesByAgent = await this.serverVerificationPromise;
    this.serverEffectiveRules = { baseUrl: server.baseUrl, rulesByAgent };
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
    abortOutcome: WorkerAbortOutcome,
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
      await this.abortSession(
        baseUrl,
        request,
        sessionId,
        warnings,
        abortOutcome,
      );
      controller.abort();
      observer.observation.catch(() => undefined);
    }
  }

  private async abortSession(
    baseUrl: string,
    request: WorkerRequest,
    sessionId: string,
    warnings: string[],
    abortOutcome: WorkerAbortOutcome,
  ): Promise<void> {
    const controller = new AbortController();
    abortOutcome.attempted = true;
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
      abortOutcome.succeeded = true;
    } catch (error) {
      const errorSnippet = snippet(String(error));
      abortOutcome.succeeded = false;
      abortOutcome.error = errorSnippet;
      warnings.push(
        `OpenCode session abort failed; session may linger until server shutdown: ${errorSnippet}`,
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
    const body = openCodePromptBody(
      request,
      messageId,
      openCodeAgentName(request, this.agentName),
      warnings,
    );
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
  permissionRejects: OpenCodePermissionRejectObservation[];
  effectiveRules?: OpenCodePermissionRule[];
  abortOutcome: WorkerAbortOutcome;
  errors?: string[];
}): WorkerResult {
  const enforcement = {
    permissionDenialCount: openCodePermissionDenialCount(
      input.tools,
      input.permissionRejects,
    ),
    abortOutcome: input.abortOutcome,
    toolEvents: input.tools.map((tool) => ({
      tool: tool.tool,
      command: tool.command,
      outcome: openCodeRuntimeToolOutcome(tool.status),
    })),
  };
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
      enforcement:
        input.effectiveRules === undefined
          ? { source: "harness-declared", ...enforcement }
          : {
              source: "verified-effective",
              effectiveRules: { rules: input.effectiveRules },
              ...enforcement,
            },
      containment: deriveContainment(input.request.toolsPolicy),
      notes: openCodeComplianceNotes(input),
    },
    warnings: input.warnings.length === 0 ? undefined : input.warnings,
    errors: input.errors,
  };
}

function openCodeRuntimeToolOutcome(
  status: string,
): "started" | "succeeded" | "denied" | "failed" | "unknown" {
  if (status === "pending" || status === "running") {
    return "started";
  }
  if (status === "completed") {
    return "succeeded";
  }
  if (status === "denied" || status === "rejected") {
    return "denied";
  }
  if (status === "error" || status === "failed") {
    return "failed";
  }
  return "unknown";
}

function openCodePermissionDenialCount(
  tools: OpenCodeToolObservation[],
  permissionRejects: OpenCodePermissionRejectObservation[],
): number {
  const denials = new Set<string>();
  for (const [index, reject] of permissionRejects.entries()) {
    denials.add(
      reject.callId === undefined
        ? `permission:${index}`
        : `call:${reject.callId}`,
    );
  }
  for (const [index, tool] of tools.entries()) {
    if (openCodeRuntimeToolOutcome(tool.status) !== "denied") {
      continue;
    }
    denials.add(
      tool.callId === undefined ? `tool:${index}` : `call:${tool.callId}`,
    );
  }
  return denials.size;
}

function openCodeComplianceNotes(input: {
  request: WorkerRequest;
  sessionId?: string;
  version?: string;
  tools: OpenCodeToolObservation[];
  permissionRejects: OpenCodePermissionRejectObservation[];
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
    notes.push(
      `OpenCode unexpected permission ask auto-rejected: ${reject.title}.`,
    );
  }
  notes.push(...input.warnings);
  return notes;
}

function toolUseSummary(
  tools: OpenCodeToolObservation[],
  permissionRejects: OpenCodePermissionRejectObservation[],
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
      permissionRejects.length === 0
        ? undefined
        : permissionRejects.map((reject) => reject.title),
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
        permission: buildOpenCodePermissionMap(
          input.toolsPolicy,
          input.environment,
        ),
      },
      [judgeAgentName]: {
        description: "Fusion no-tools judge",
        mode: "primary",
        permission: buildOpenCodePermissionMap({ mode: "none" }, undefined),
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
    read: allowedTools.has("read") ? "allow" : "deny",
    grep: allowedTools.has("grep") ? "allow" : "deny",
    glob: allowedTools.has("glob") ? "allow" : "deny",
    list: allowedTools.has("list") ? "allow" : "deny",
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
}): Promise<Map<string, OpenCodePermissionRule[]>> {
  const value = await requestJson<unknown>(
    input.fetch,
    input.baseUrl,
    "/agent",
    { method: "GET" },
    input.environment,
  );
  const agents = openCodeAgentInfos(value);
  const policies = new Map<string, ToolsPolicy | undefined>([
    [input.agentName, input.toolsPolicy],
    [judgeAgentName, { mode: "none" }],
  ]);
  const expected = [...policies].map(([agentName, toolsPolicy]) => ({
    agent: agentName,
    decisions: openCodeProbeDecisions(
      expectedOpenCodePermissionRules(toolsPolicy),
      toolsPolicy,
    ),
  }));
  const observed = [...policies].map(([agentName, toolsPolicy]) => {
    const agent = agents.find((candidate) => candidate.name === agentName);
    return agent === undefined
      ? { agent: agentName, availableAgents: agents.map(({ name }) => name) }
      : {
          agent: agentName,
          decisions: openCodeProbeDecisions(agent.permission, toolsPolicy),
        };
  });
  const mismatches = expected.flatMap((expectedAgent) => {
    const observedAgent = observed.find(
      (candidate) => candidate.agent === expectedAgent.agent,
    );
    if (observedAgent?.decisions === undefined) {
      return expectedAgent.decisions.map((expectedDecision) => ({
        agent: expectedAgent.agent,
        probe: {
          permission: expectedDecision.permission,
          pattern: expectedDecision.pattern,
        },
        expected: expectedDecision.action,
        observed: undefined,
      }));
    }
    const observedDecisions = observedAgent.decisions;
    return expectedAgent.decisions.flatMap((expectedDecision) => {
      const observedDecision = observedDecisions.find(
        (candidate) =>
          candidate.permission === expectedDecision.permission &&
          candidate.pattern === expectedDecision.pattern,
      );
      return observedDecision?.action === expectedDecision.action
        ? []
        : [
            {
              agent: expectedAgent.agent,
              probe: {
                permission: expectedDecision.permission,
                pattern: expectedDecision.pattern,
              },
              expected: expectedDecision.action,
              observed: observedDecision?.action,
            },
          ];
    });
  });
  if (mismatches.length === 0) {
    return new Map(
      [...policies.keys()].map((agentName) => [
        agentName,
        agents.find((candidate) => candidate.name === agentName)!.permission,
      ]),
    );
  }

  throw new OpenCodeEffectiveRulesError(
    `OpenCode effective permission verification failed: ${JSON.stringify({
      code: "OPENCODE_EFFECTIVE_RULES_MISMATCH",
      expected,
      observed,
      mismatches,
    })}`,
  );
}

function expectedOpenCodePermissionRules(
  toolsPolicy: ToolsPolicy | undefined,
): OpenCodePermissionRule[] {
  const permission = buildOpenCodePermissionMap(toolsPolicy, undefined);
  return Object.entries(permission).flatMap(([permissionId, decision]) =>
    typeof decision === "string"
      ? [{ permission: permissionId, pattern: "*", action: decision }]
      : Object.entries(decision).map(([pattern, action]) => ({
          permission: permissionId,
          pattern,
          action,
        })),
  );
}

function openCodeProbeDecisions(
  rules: OpenCodePermissionRule[],
  toolsPolicy: ToolsPolicy | undefined,
): Array<OpenCodePermissionRule> {
  const bashCommands = [
    "git status",
    "git status --short",
    "git commit -m x",
    "pip install x",
    "bun run x",
    ...(toolsPolicy?.readOnlyBashCommands ?? []).flatMap((command) => [
      command,
      `${command} x`,
    ]),
  ];
  const probes = [
    ...[...new Set(bashCommands)].map((pattern) => ({
      permission: "bash",
      pattern,
    })),
    ...[
      "edit",
      "write",
      "read",
      "grep",
      "glob",
      "webfetch",
      "websearch",
      "skill",
      "mcp_some_tool",
    ].map((permission) => ({ permission, pattern: "*" })),
  ];
  return probes.map((probe) => ({
    ...probe,
    action: openCodeEffectiveDecision(rules, probe.permission, probe.pattern),
  }));
}

function openCodeEffectiveDecision(
  rules: OpenCodePermissionRule[],
  permission: string,
  pattern: string,
): PermissionDecision {
  return rules.findLast(
    (rule) =>
      openCodeGlobMatches(rule.permission, permission) &&
      openCodeGlobMatches(rule.pattern, pattern),
  )?.action ?? "ask";
}

function openCodeGlobMatches(glob: string, value: string): boolean {
  if (glob.endsWith(" *") && value === glob.slice(0, -2)) {
    return true;
  }
  const pattern = glob
    .split("*")
    .map((part) => part.replace(/[\\^$+?.()|[\]{}]/gu, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}$`, "u").test(value);
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
    const tool = toolObservationFromPart(part);
    if (
      tool !== undefined &&
      tool.status !== "pending" &&
      tool.status !== "running"
    ) {
      observation.tools.push(tool);
      if (tool.status === "denied") {
        observation.warnings.push(
          `OpenCode tool ${tool.tool} was denied by permission controls.`,
        );
      } else if (tool.status === "error") {
        observation.warnings.push(
          `OpenCode tool ${tool.tool} ended with error.`,
        );
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
  observation.permissionRejects.push({
    title: permission.title || permission.type,
    callId: permission.callID,
  });
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
      ...input.env,
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
      return record === undefined ? undefined : toolObservationFromPart(record);
    })
    .filter((tool): tool is OpenCodeToolObservation => tool !== undefined);
}

function toolObservationFromPart(
  part: Record<string, unknown>,
): OpenCodeToolObservation | undefined {
  if (part.type !== "tool") {
    return undefined;
  }
  const state = objectField(part, "state");
  const status = state === undefined ? undefined : stringField(state, "status");
  const error = state === undefined ? undefined : stringField(state, "error");
  const tool = stringField(part, "tool");
  const toolInput = state === undefined ? undefined : objectField(state, "input");
  const command =
    toolInput === undefined ? undefined : stringField(toolInput, "command");
  if (tool === undefined || status === undefined) {
    return undefined;
  }
  return {
    tool,
    status:
      status === "error" && isOpenCodePermissionDenialError(error)
        ? "denied"
        : status,
    command,
    callId: stringField(part, "callID"),
  };
}

function isOpenCodePermissionDenialError(error: string | undefined): boolean {
  return (
    error !== undefined &&
    openCodePermissionDenialErrorPrefixes.some((prefix) =>
      error.startsWith(prefix),
    )
  );
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
