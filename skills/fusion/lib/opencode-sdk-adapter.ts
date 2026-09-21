import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  AgentInfo,
  OpenCodeEvent,
  PermissionRule,
} from "@opencode/client";
import { deriveContainment } from "./containment";
import { instructionEnvironmentDisclosures } from "./instruction-environment";
import {
  assertNoStrictToolPolicyGap,
  isBashDenied,
  normalizeToolName,
  readOnlyDefaultAllowedTools,
  toolPolicyWarnings,
  unsupportedCommandPatternDenies,
} from "./tool-policy";
import {
  executeCommand,
  modelPreferenceToModel,
  type CommandExecutor,
} from "./headless-cli-adapters";
import { fusionPanelDepthEnv, nextFusionPanelDepth } from "./panel-depth";
import type {
  ToolsPolicy,
  WorkerAbortOutcome,
  WorkerEnvironment,
  WorkerRequest,
  WorkerResult,
  WorkerRunner,
} from "./types";

type Fetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
export type OpenCodePermissionConfig = PermissionRule[];
export interface OpenCodeAgentConfig {
  description: string;
  mode: "primary";
  permissions: OpenCodePermissionConfig;
}
export interface OpenCodeConfigContent {
  agents: Record<string, OpenCodeAgentConfig>;
  warming: false;
  share: "disabled";
  websearch: { provider: "exa" };
}
export interface OpenCodeSdkAdapterOptions {
  command?: string;
  /** Externally owned server; requires serverPassword. It is never shut down. */
  baseUrl?: string;
  serverPassword?: string;
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
  env: Record<string, string | undefined>;
  /** Authenticated fetch; do not log its credentials or input.env. */
  fetch: Fetch;
}
export type OpenCodeServerFactory = (
  input: OpenCodeServerFactoryInput,
) => Promise<OpenCodeServerHandle>;

type ToolObservation = {
  tool: string;
  status: "started" | "succeeded" | "denied" | "failed";
  command?: string;
  callId: string;
};
type PermissionRejection = { title: string; callId?: string };
interface Observation {
  output: string;
  modelUsed?: string;
  usage?: WorkerResult["usage"];
  tools: Map<string, ToolObservation>;
  rejections: PermissionRejection[];
}
const workerAgent = "fusion-worker";
const judgeAgent = "fusion-judge";
const cleanupTimeoutMs = 5_000;
const startupTimeoutMs = 30_000;
const hardDeniedTools = new Set([
  "write",
  "patch",
  "task",
  "subagent",
  "todowrite",
  "skill",
  "lsp",
  "doom_loop",
  "execute",
]);
const knownTools = [
  "read",
  "grep",
  "glob",
  "list",
  "webfetch",
  "websearch",
  "edit",
];

function agentFor(request: WorkerRequest, workerName: string): string {
  return request.toolsPolicy?.mode === "none" ? judgeAgent : workerName;
}
function directoryFor(environment?: WorkerEnvironment): string {
  return resolve(
    environment?.workingDirectory ??
      environment?.workspaceRoot ??
      process.cwd(),
  );
}
function policyFingerprint(request: WorkerRequest): string {
  return JSON.stringify({
    directory: directoryFor(request.environment),
    rules: buildOpenCodePermissionRules(
      request.toolsPolicy,
      request.environment,
    ),
  });
}

/** OpenCode 2.0.12+ machine protocol. There is deliberately no v1/CLI fallback. */
export class OpenCodeSdkAdapter implements WorkerRunner {
  private readonly command: string;
  private readonly fetch: Fetch;
  private readonly serverFactory: OpenCodeServerFactory;
  private readonly versionExecutor: CommandExecutor;
  private readonly agentName: string;
  private readonly injectedBaseUrl?: string;
  private readonly password: string;
  private readonly authorization: string;
  private readonly injectedPasswordMissing: boolean;
  private serverPromise?: Promise<OpenCodeServerHandle>;
  private fingerprint?: string;
  private serverDirectory?: string;
  private version?: string;
  private disposed = false;

  constructor(options: OpenCodeSdkAdapterOptions = {}) {
    this.command = options.command ?? "opencode";
    this.serverFactory = options.serverFactory ?? spawnOpenCodeServer;
    this.versionExecutor = options.versionExecutor ?? executeCommand;
    this.agentName = options.agentName ?? workerAgent;
    this.injectedBaseUrl = options.baseUrl;
    this.injectedPasswordMissing =
      options.baseUrl !== undefined && !options.serverPassword;
    this.password =
      options.serverPassword ?? randomBytes(32).toString("base64url");
    this.authorization = `Basic ${Buffer.from(`opencode:${this.password}`).toString("base64")}`;
    const fetchImpl = options.fetch ?? fetch;
    this.fetch = (input, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", this.authorization);
      return fetchImpl(input, { ...init, headers, redirect: "error" });
    };
  }

  async runWorker(request: WorkerRequest): Promise<WorkerResult> {
    const start = Date.now();
    const warnings = toolPolicyWarnings(request.toolsPolicy);
    const observation: Observation = {
      output: "",
      tools: new Map(),
      rejections: [],
    };
    const abortOutcome: WorkerAbortOutcome = { attempted: false };
    let sessionId: string | undefined;
    let effectiveRules: PermissionRule[] | undefined;
    let server: OpenCodeServerHandle | undefined;
    let status: WorkerResult["status"] = "error";
    let errors: string[] | undefined;
    const controller = new AbortController();
    const streamController = new AbortController();
    const timeoutMs = request.budget?.timeoutMs ?? 300_000;
    const timer = setTimeout(
      () =>
        controller.abort(
          new WorkerTimeoutError("OpenCode SDK worker timed out."),
        ),
      timeoutMs,
    );
    try {
      if (this.disposed) throw new Error("OpenCode adapter has been disposed.");
      if (request.session.mode !== "fresh")
        throw new Error("OpenCode v2 supports fresh sessions only.");
      if (this.injectedPasswordMissing)
        throw new Error(
          "An injected OpenCode baseUrl requires serverPassword.",
        );
      assertNoStrictToolPolicyGap(request.toolsPolicy, "opencode-sdk", (tool) =>
        hardDeniedTools.has(tool),
      );
      preferenceWarnings(request, warnings);
      server = await abortable(this.ensureServer(request), controller.signal);
      // Reinspect on every invocation: v2 can reload agent/config state while alive.
      const rulesByAgent = await verifyEffectiveRules(
        this.fetch,
        server.baseUrl,
        this.agentName,
        request,
        controller.signal,
      );
      effectiveRules = rulesByAgent.get(agentFor(request, this.agentName));
      const created = await requestJson(
        this.fetch,
        server.baseUrl,
        "/api/session",
        {
          method: "POST",
          signal: controller.signal,
          body: {
            title: `Fusion ${request.workerId}`,
            agent: agentFor(request, this.agentName),
            model: splitOpenCodeModel(
              modelPreferenceToModel(request.modelPreference),
            ),
            location: { directory: directoryFor(request.environment) },
          },
        },
      );
      const session = recordField(created, "data");
      sessionId = requiredString(session, "id");
      if (
        session?.agent !== agentFor(request, this.agentName) ||
        recordField(session, "location")?.directory !==
          directoryFor(request.environment)
      ) {
        throw new Error(
          "OpenCode session agent/location differs from the requested session.",
        );
      }
      // A fresh session must not introduce a higher-precedence policy override.
      if (Array.isArray(session.permissions) && session.permissions.length > 0)
        throw new Error(
          "OpenCode fresh session unexpectedly overrides agent permissions.",
        );
      await this.promptAndObserve(
        server.baseUrl,
        request,
        sessionId,
        observation,
        warnings,
        controller.signal,
        streamController.signal,
      );
      if (!observation.output.trim())
        throw new Error(
          "OpenCode v2 execution succeeded without final assistant text.",
        );
      status = "ok";
    } catch (error) {
      status =
        controller.signal.reason instanceof WorkerTimeoutError
          ? "timeout"
          : "error";
      errors = [
        this.redact(
          String(controller.signal.aborted ? controller.signal.reason : error),
        ),
      ];
    } finally {
      clearTimeout(timer);
      // Keep the event reader attached until remote interrupt is attempted.
      if (server !== undefined && sessionId !== undefined) {
        Object.assign(
          abortOutcome,
          await this.interruptSession(server.baseUrl, sessionId, warnings),
        );
      }
      streamController.abort();
      controller.abort();
    }
    const tools = [...observation.tools.values()];
    const denied = new Map<string, string>();
    observation.rejections.forEach((item, index) =>
      denied.set(item.callId ?? `ask:${index}`, item.title),
    );
    tools
      .filter((tool) => tool.status === "denied")
      .forEach((tool) =>
        denied.set(
          tool.callId,
          tool.command ? `${tool.tool}: ${tool.command}` : tool.tool,
        ),
      );
    const enforcement = {
      permissionDenialCount: denied.size,
      abortOutcome,
      toolEvents: tools.map(({ tool, command, status: outcome }) => ({
        tool,
        command,
        outcome,
      })),
    };
    return {
      panelRunId: request.panelRunId,
      workerId: request.workerId,
      status,
      output: observation.output.trim(),
      sessionId,
      modelUsed: observation.modelUsed,
      harnessUsed: {
        kind: "opencode",
        invocation: "headless",
        transport: "sdk",
        version: this.version,
      },
      usage: { ...observation.usage, durationMs: Date.now() - start },
      toolUseSummary:
        tools.length || denied.size
          ? {
              toolsUsed: [
                ...new Set(
                  tools
                    .filter((tool) => tool.status !== "denied")
                    .map((tool) => tool.tool),
                ),
              ],
              deniedRequests: [...denied.values()],
            }
          : undefined,
      complianceEvidence: {
        adapterClaimsIndependentInvocation: sessionId !== undefined,
        adapterClaimsIsolatedContext: sessionId !== undefined,
        adapterClaimsBlindness: true,
        observedSessionMode: "fresh",
        containment: deriveContainment(request.toolsPolicy),
        enforcement:
          effectiveRules === undefined
            ? { source: "harness-declared", ...enforcement }
            : {
                source: "verified-effective",
                effectiveRules: { rules: effectiveRules },
                ...enforcement,
              },
        notes: [
          effectiveRules
            ? "OpenCode v2 native agent permissions were inspected before prompting; unknown tools and recursive delegation are denied."
            : "OpenCode effective permission verification did not complete; no prompt was authorized.",
          ...(sessionId
            ? [`OpenCode fresh session id observed: ${sessionId}.`]
            : []),
          ...(this.injectedBaseUrl
            ? [
                "Externally owned OpenCode server: Fusion does not control its startup instruction environment.",
              ]
            : instructionEnvironmentDisclosures({
                kind: "opencode",
                transport: "sdk",
              }).map((item) => item.note)),
          ...warnings.map((warning) => this.redact(warning)),
        ],
      },
      warnings: warnings.length
        ? warnings.map((item) => this.redact(item))
        : undefined,
      errors,
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await (await this.serverPromise?.catch(() => undefined))?.dispose();
  }

  private async interruptSession(
    baseUrl: string,
    sessionId: string,
    warnings: string[],
  ): Promise<WorkerAbortOutcome> {
    try {
      const value = await requestJson(
        this.fetch,
        baseUrl,
        `/api/session/${encodeURIComponent(sessionId)}/interrupt`,
        { method: "POST", signal: AbortSignal.timeout(cleanupTimeoutMs) },
      );
      if (typeof value?.interrupted !== "boolean")
        throw new Error("Invalid OpenCode interrupt response.");
      // interrupted:false is the documented idle no-op, not cleanup failure.
      return { attempted: true, succeeded: true };
    } catch (error) {
      const message = this.redact(String(error));
      warnings.push(
        `OpenCode session interrupt failed; owned server shutdown is the final backstop: ${message}`,
      );
      return { attempted: true, succeeded: false, error: message };
    }
  }

  private redact(text: string): string {
    return text
      .replaceAll(this.password, "[REDACTED]")
      .replaceAll(this.authorization, "[REDACTED]")
      .replaceAll(this.authorization.slice(6), "[REDACTED]")
      .slice(0, 2000);
  }

  private async ensureServer(
    request: WorkerRequest,
  ): Promise<OpenCodeServerHandle> {
    const fingerprint = policyFingerprint(request);
    const directory = directoryFor(request.environment);
    if (this.serverPromise) {
      if (
        this.serverDirectory !== directory ||
        (request.toolsPolicy?.mode !== "none" &&
          this.fingerprint !== fingerprint)
      )
        throw new Error(
          "OPENCODE_SHARED_SERVER_POLICY_MISMATCH: worker policy or location differs from the shared server.",
        );
      return this.serverPromise;
    }
    this.fingerprint = fingerprint;
    this.serverDirectory = directory;
    this.serverPromise = (async () => {
      let server: OpenCodeServerHandle;
      if (this.injectedBaseUrl !== undefined) {
        server = { baseUrl: this.injectedBaseUrl, dispose() {} };
      } else {
        const result = await this.versionExecutor({
          command: this.command,
          args: ["--version"],
          timeoutMs: startupTimeoutMs,
        });
        const localVersion = /^(?:opencode\s+v?)?(\d+\.\d+\.\d+)\s*$/mu.exec(
          result.stdout,
        )?.[1];
        assertSupportedVersion(localVersion);
        const configDirectory = await mkdtemp(
          join(tmpdir(), "fusion-opencode-config-"),
        );
        try {
          const owned = await this.serverFactory({
            command: this.command,
            cwd: directory,
            fetch: this.fetch,
            configContent: buildOpenCodeConfigContent({
              toolsPolicy: request.toolsPolicy,
              environment: request.environment,
              agentName: this.agentName,
            }),
            env: {
              [fusionPanelDepthEnv]: nextFusionPanelDepth(),
              OPENCODE_CONFIG: undefined,
              OPENCODE_CONFIG_DIR: configDirectory,
              XDG_CONFIG_HOME: configDirectory,
              OPENCODE_PASSWORD: this.password,
              OPENCODE_SERVER_PASSWORD: undefined,
              OPENCODE_PTY_HANDOFF: undefined,
              OPENCODE_SIMULATE: undefined,
            },
          });
          server = {
            baseUrl: owned.baseUrl,
            async dispose() {
              try {
                await owned.dispose();
              } finally {
                await rm(configDirectory, { recursive: true, force: true });
              }
            },
          };
        } catch (error) {
          await rm(configDirectory, { recursive: true, force: true });
          throw error;
        }
      }
      try {
        const info = await requestJson(
          this.fetch,
          server.baseUrl,
          "/api/info",
          { signal: AbortSignal.timeout(startupTimeoutMs) },
        );
        assertServerInfo(info);
        this.version = info.version as string;
        return server;
      } catch (error) {
        await server.dispose();
        throw error;
      }
    })();
    return this.serverPromise;
  }

  private async promptAndObserve(
    baseUrl: string,
    request: WorkerRequest,
    sessionId: string,
    observation: Observation,
    warnings: string[],
    signal: AbortSignal,
    streamSignal: AbortSignal,
  ): Promise<void> {
    let readyResolve!: () => void;
    let readyReject!: (reason: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const collected = collectEvents({
      fetch: this.fetch,
      baseUrl,
      sessionId,
      observation,
      warnings,
      signal: streamSignal,
      ready: readyResolve,
    });
    collected.catch(readyReject);
    await abortable(ready, signal);
    const id = `msg_${randomUUID().replaceAll("-", "")}`;
    const admission = await requestJson(
      this.fetch,
      baseUrl,
      `/api/session/${encodeURIComponent(sessionId)}/prompt`,
      { method: "POST", body: { id, text: request.prompt }, signal },
    );
    const data = recordField(admission, "data");
    if (data?.id !== id || data.sessionID !== sessionId || data.type !== "user")
      throw new Error("Invalid OpenCode prompt admission response.");
    await abortable(collected, signal);
  }
}

function assertServerInfo(
  info: Record<string, unknown> | undefined,
): asserts info is Record<string, unknown> {
  assertSupportedVersion(info?.version);
  if (
    !Number.isInteger(info?.pid) ||
    (info!.pid as number) < 0 ||
    !Array.isArray(info?.urls) ||
    !info.urls.every((url) => typeof url === "string") ||
    typeof recordField(info, "paths")?.tmp !== "string"
  )
    throw new Error("Invalid OpenCode server identity response.");
}

function assertSupportedVersion(value: unknown): asserts value is string {
  const match = typeof value === "string" ? /^2\.0\.(\d+)$/u.exec(value) : null;
  if (!match || Number(match[1]) < 12)
    throw new Error(
      `Unsupported OpenCode version ${typeof value === "string" ? value : "unknown"}; Fusion requires OpenCode 2.0.12+ in the 2.0 release line. No v1 or CLI fallback is available.`,
    );
}

export function buildOpenCodeConfigContent(input: {
  toolsPolicy: ToolsPolicy | undefined;
  environment: WorkerEnvironment | undefined;
  agentName?: string;
}): OpenCodeConfigContent {
  return {
    warming: false,
    share: "disabled",
    websearch: { provider: "exa" },
    agents: {
      [input.agentName ?? workerAgent]: {
        description: "Fusion read-only worker",
        mode: "primary",
        permissions: buildOpenCodePermissionRules(
          input.toolsPolicy,
          input.environment,
        ),
      },
      [judgeAgent]: {
        description: "Fusion no-tools judge",
        mode: "primary",
        permissions: buildOpenCodePermissionRules({ mode: "none" }, undefined),
      },
    },
  };
}

export function buildOpenCodePermissionRules(
  policy: ToolsPolicy | undefined,
  environment: WorkerEnvironment | undefined,
): PermissionRule[] {
  const rules: PermissionRule[] = [
    { action: "*", resource: "*", effect: "deny" },
  ];
  if (policy?.mode === "none") return rules;
  const unsupported = new Set(unsupportedCommandPatternDenies(policy));
  const denied = new Set(
    (policy?.deny ?? [])
      .filter((tool) => !unsupported.has(tool))
      .map(normalizeToolName),
  );
  const allowed = new Set(
    (policy?.mode === "full"
      ? knownTools
      : (policy?.allow ??
        (policy?.mode === "limited" ? [] : readOnlyDefaultAllowedTools))
    ).map(normalizeToolName),
  );
  for (const action of knownTools) {
    if (
      allowed.has(action) &&
      !denied.has(action) &&
      !(action === "edit" && (denied.has("write") || denied.has("patch")))
    )
      rules.push({ action, resource: "*", effect: "allow" });
  }
  // Resource matching remains the harness allowlist, not an OS sandbox.
  rules.push({ action: "shell", resource: "*", effect: "deny" });
  if (!isBashDenied(policy)) {
    if (policy?.mode === "full")
      rules.push({ action: "shell", resource: "*", effect: "allow" });
    else
      for (const command of policy?.readOnlyBashCommands ?? []) {
        rules.push(
          { action: "shell", resource: command, effect: "allow" },
          { action: "shell", resource: `${command} *`, effect: "allow" },
        );
      }
  }
  rules.push({ action: "external_directory", resource: "*", effect: "deny" });
  for (const root of environment?.readRoots ?? []) {
    const path = resolve(root);
    rules.push(
      { action: "external_directory", resource: path, effect: "allow" },
      {
        action: "external_directory",
        resource: `${path === "/" ? "" : path}/**`,
        effect: "allow",
      },
    );
  }
  return rules;
}

async function verifyEffectiveRules(
  fetchImpl: Fetch,
  baseUrl: string,
  agentName: string,
  request: WorkerRequest,
  signal: AbortSignal,
): Promise<Map<string, PermissionRule[]>> {
  const expected = new Map([
    [
      agentName,
      buildOpenCodePermissionRules(request.toolsPolicy, request.environment),
    ],
    [judgeAgent, buildOpenCodePermissionRules({ mode: "none" }, undefined)],
  ]);
  // The no-tools judge may reuse a worker server, but must not reclassify its
  // worker rules as no-tools. Only inspect the selected judge in that case.
  if (request.toolsPolicy?.mode === "none") expected.delete(agentName);
  const deadline = Date.now() + startupTimeoutMs;
  while (true) {
    const url = new URL("/api/agent", baseUrl);
    url.searchParams.set(
      "location[directory]",
      directoryFor(request.environment),
    );
    const value = await requestJson(fetchImpl, baseUrl, url.toString(), {
      signal,
    });
    if (!Array.isArray(value?.data))
      throw new Error("Invalid OpenCode agent list response.");
    const agents = value.data as unknown[];
    const result = new Map<string, PermissionRule[]>();
    let missing = false;
    for (const [id, rules] of expected) {
      const agent = agents.map(objectValue).find((item) => item?.id === id);
      if (!agent) {
        missing = true;
        continue;
      }
      const permissions = parseRules(agent.permissions);
      // Everything preceding our catch-all reset is shadowed. Requiring the
      // exact suffix rejects extra permissions, reordered rules and missing
      // read roots, rather than merely sampling a few known tool names.
      if (
        JSON.stringify(permissions.slice(-rules.length)) !==
        JSON.stringify(rules)
      )
        throw new Error(
          `OPENCODE_EFFECTIVE_RULES_MISMATCH: ${id} does not end with the expected ordered deny-by-default policy.`,
        );
      result.set(id, permissions);
    }
    if (!missing) return result;
    // v2.0.12 initially returns [] while location plugins are still loading.
    // This is readiness, not permission to run behind missing enforcement.
    if (Date.now() >= deadline)
      throw new Error(
        "OPENCODE_EFFECTIVE_RULES_MISMATCH: required Fusion agents did not become available.",
      );
    await abortable(new Promise((resolve) => setTimeout(resolve, 50)), signal);
  }
}

function parseRules(value: unknown): AgentInfo["permissions"] {
  if (!Array.isArray(value))
    throw new Error("Invalid OpenCode effective permissions.");
  return value.map((item) => {
    const record = objectValue(item);
    const action = requiredString(record, "action");
    const resource = requiredString(record, "resource");
    const effect = record?.effect;
    if (effect !== "allow" && effect !== "deny" && effect !== "ask")
      throw new Error("Invalid OpenCode permission effect.");
    return { action, resource, effect };
  });
}

export function splitOpenCodeModel(
  model: string | undefined,
): { providerID: string; id: string; variant?: string } | undefined {
  if (model === undefined) return undefined;
  const match = /^([^/]+)\/(.+?)(?:#([^#]+))?$/u.exec(model);
  if (!match) throw new Error("OpenCode model must use provider/model format.");
  return {
    providerID: match[1]!,
    id: match[2]!,
    ...(match[3] ? { variant: match[3] } : {}),
  };
}

function preferenceWarnings(request: WorkerRequest, warnings: string[]): void {
  if (request.reasoning?.effort !== undefined)
    warnings.push(
      "OpenCode SDK reasoning.effort is not mapped; the provider default is retained.",
    );
  if (request.reasoning?.maxTokens !== undefined)
    warnings.push("OpenCode SDK reasoning.maxTokens is not mapped.");
  for (const key of [
    "maxTurns",
    "maxToolCalls",
    "maxInputTokens",
    "maxOutputTokens",
  ] as const)
    if (request.budget?.[key] !== undefined)
      warnings.push(`OpenCode SDK budget.${key} is not mapped.`);
}

type EventInput = {
  fetch: Fetch;
  baseUrl: string;
  sessionId: string;
  observation: Observation;
  warnings: string[];
  signal: AbortSignal;
  ready: () => void;
};
async function collectEvents(input: EventInput): Promise<void> {
  const response = await input.fetch(new URL("/api/event", input.baseUrl), {
    headers: { Accept: "text/event-stream" },
    signal: input.signal,
  });
  if (
    !response.ok ||
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  )
    throw new Error(`OpenCode event stream failed: HTTP ${response.status}.`);
  let connected = false;
  let latestMessage: string | undefined;
  let latestFinish: string | undefined;
  const texts = new Map<string, Map<number, string>>();
  const usage = new Map<string, NonNullable<WorkerResult["usage"]>>();
  for await (const json of readSse(response.body)) {
    let event: Record<string, unknown> | undefined;
    try {
      event = objectValue(JSON.parse(json));
    } catch {
      throw new Error(
        "Malformed OpenCode SSE JSON; completion cannot be proven.",
      );
    }
    if (!event || typeof event.type !== "string" || !objectValue(event.data))
      throw new Error("Malformed OpenCode event envelope.");
    const type = event.type as OpenCodeEvent["type"];
    const data = objectValue(event.data)!;
    if (type === "server.connected") {
      connected = true;
      input.ready();
      continue;
    }
    if (!connected)
      throw new Error(
        "OpenCode emitted events before the subscription handshake.",
      );
    if (data.sessionID !== input.sessionId) continue;
    switch (type) {
      case "session.step.started": {
        latestMessage = requiredString(data, "assistantMessageID");
        latestFinish = undefined;
        const model = recordField(data, "model");
        input.observation.modelUsed = `${requiredString(model, "providerID")}/${requiredString(model, "id")}`;
        break;
      }
      case "session.text.ended": {
        const id = requiredString(data, "assistantMessageID");
        if (
          !Number.isInteger(data.ordinal) ||
          (data.ordinal as number) < 0 ||
          typeof data.text !== "string"
        )
          throw new Error("Invalid OpenCode text boundary.");
        const parts = texts.get(id) ?? new Map<number, string>();
        parts.set(data.ordinal as number, data.text);
        texts.set(id, parts);
        break;
      }
      case "session.step.ended":
      case "session.step.failed": {
        const id = requiredString(data, "assistantMessageID");
        if (id === latestMessage)
          latestFinish =
            typeof data.finish === "string" ? data.finish : "error";
        const tokens = recordField(data, "tokens");
        usage.set(id, {
          inputTokens: numberField(tokens, "input"),
          outputTokens: numberField(tokens, "output"),
          costUsd: numberField(data, "cost"),
        });
        input.observation.usage = sumUsage([...usage.values()]);
        if (type === "session.step.failed")
          input.warnings.push(
            `OpenCode step failed: ${errorMessage(data.error)}.`,
          );
        break;
      }
      case "session.tool.input.started": {
        const id = requiredString(data, "id");
        input.observation.tools.set(id, {
          callId: id,
          tool: requiredString(data, "name"),
          status: "started",
        });
        break;
      }
      case "session.tool.called":
      case "session.tool.success":
      case "session.tool.failed": {
        const id = requiredString(data, "id");
        const tool = input.observation.tools.get(id);
        if (!tool)
          throw new Error(
            "OpenCode tool event is missing its name/start boundary.",
          );
        if (type === "session.tool.called")
          tool.command = stringField(recordField(data, "input"), "command");
        else if (type === "session.tool.success") tool.status = "succeeded";
        else {
          tool.status =
            recordField(data, "error")?.type === "permission.rejected" ||
            input.observation.rejections.some(
              (rejection) => rejection.callId === id,
            )
              ? "denied"
              : "failed";
          input.warnings.push(`OpenCode tool ${tool.tool} ${tool.status}.`);
        }
        break;
      }
      case "permission.asked": {
        const id = requiredString(data, "id");
        const action = requiredString(data, "action");
        const source = recordField(data, "source");
        input.observation.rejections.push({
          title: action,
          callId: stringField(source, "id"),
        });
        input.warnings.push(
          `OpenCode unexpected permission ask auto-rejected: ${action}.`,
        );
        await requestJson(
          input.fetch,
          input.baseUrl,
          `/api/session/${encodeURIComponent(input.sessionId)}/permission/${encodeURIComponent(id)}/reply`,
          {
            method: "POST",
            body: {
              decision: "reject",
              message:
                "Fusion policy denies this operation. Continue with permitted tools and disclose the limitation.",
            },
            signal: input.signal,
          },
        );
        break;
      }
      case "session.retry.scheduled":
        input.warnings.push(
          `OpenCode provider call is retrying: ${errorMessage(data.error)}.`,
        );
        break;
      case "session.execution.failed":
        throw new Error(
          `OpenCode execution failed: ${errorMessage(data.error)}`,
        );
      case "session.execution.interrupted":
        throw new Error(
          `OpenCode execution interrupted: ${stringField(data, "reason") ?? "unknown"}`,
        );
      case "session.execution.succeeded": {
        if (
          !latestMessage ||
          !latestFinish ||
          latestFinish === "tool-calls" ||
          latestFinish === "error"
        )
          throw new Error(
            "OpenCode execution has no completed final assistant step.",
          );
        const parts = texts.get(latestMessage);
        input.observation.output = parts
          ? [...parts]
              .sort(([a], [b]) => a - b)
              .map(([, text]) => text)
              .join("\n")
          : "";
        return;
      }
    }
  }
  throw new Error(
    "OpenCode event stream ended before execution completion; live streams cannot replay missing events.",
  );
}

function sumUsage(
  values: NonNullable<WorkerResult["usage"]>[],
): NonNullable<WorkerResult["usage"]> {
  const result: NonNullable<WorkerResult["usage"]> = {};
  for (const key of ["inputTokens", "outputTokens", "costUsd"] as const) {
    const numbers = values
      .map((value) => value[key])
      .filter((value): value is number => value !== undefined);
    if (numbers.length) result[key] = numbers.reduce((a, b) => a + b, 0);
  }
  return result;
}

async function* readSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 4_000_000)
        throw new Error("OpenCode SSE frame exceeds the size limit.");
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/u.exec(buffer)) !== null) {
        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const lines = block
          .split(/\r?\n/u)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart());
        if (lines.length) yield lines.join("\n");
      }
    }
    if (buffer.trim()) throw new Error("Truncated OpenCode SSE frame.");
  } finally {
    // The owner aborts the stream only after remote interrupt, including on
    // successful collection. Releasing a reader lock does not disconnect SSE.
    reader.releaseLock();
  }
}

async function requestJson(
  fetchImpl: Fetch,
  baseUrl: string,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal } = {},
): Promise<Record<string, unknown> | undefined> {
  const pending = fetchImpl(new URL(path, baseUrl), {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });
  const response = await (init.signal
    ? abortable(pending, init.signal)
    : pending);
  // Do not echo untrusted HTTP bodies or credentials into recorded errors.
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `OpenCode ${init.method ?? "GET"} ${new URL(path, baseUrl).pathname} failed with HTTP ${response.status}.`,
    );
  }
  if (response.status === 204) return undefined;
  const decoded = response.json();
  const value: unknown = await (init.signal
    ? abortable(decoded, init.signal)
    : decoded);
  const record = objectValue(value);
  if (!record) throw new Error("Invalid OpenCode JSON response.");
  return record;
}

async function spawnOpenCodeServer(
  input: OpenCodeServerFactoryInput,
): Promise<OpenCodeServerHandle> {
  const port = await freePort();
  // --stdio removes server credentials from the tool environment and makes
  // stdin lifetime an additional parent-death cleanup boundary (v2.0.12).
  const child = spawn(
    input.command,
    ["serve", "--stdio", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: input.cwd,
      env: {
        ...process.env,
        ...input.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(input.configContent),
      },
      stdio: ["pipe", "ignore", "ignore"],
    },
  );
  let spawnError: Error | undefined;
  child.once("error", (error) => {
    spawnError = error;
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
      if (spawnError)
        throw new Error(
          `OpenCode serve failed to spawn: ${spawnError.message}`,
        );
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(
          `OpenCode serve exited before readiness (${child.exitCode ?? child.signalCode}).`,
        );
      try {
        const info = await requestJson(input.fetch, baseUrl, "/api/info", {
          signal: AbortSignal.timeout(1_000),
        });
        assertServerInfo(info);
        return { baseUrl, dispose: () => stopChild(child) };
      } catch (error) {
        if (
          /Unsupported OpenCode|Invalid OpenCode server identity|HTTP (?:401|403|404)/u.test(
            String(error),
          )
        )
          throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      "OpenCode authenticated readiness timed out (expected /api/info, not 401/404).",
    );
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not allocate localhost port.");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
async function stopChild(child: ChildProcess): Promise<void> {
  if (
    child.exitCode !== null ||
    child.signalCode !== null ||
    child.pid === undefined
  )
    return;
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  child.stdin?.end();
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 1_000);
  try {
    await closed;
  } finally {
    clearTimeout(timer);
  }
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new Error("OpenCode request aborted."));
    if (signal.aborted) {
      promise.catch(() => undefined);
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function recordField(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  return objectValue(objectValue(value)?.[key]);
}
function stringField(value: unknown, key: string): string | undefined {
  const field = objectValue(value)?.[key];
  return typeof field === "string" ? field : undefined;
}
function requiredString(value: unknown, key: string): string {
  const result = stringField(value, key);
  if (result === undefined || !result.length)
    throw new Error(`OpenCode protocol field ${key} is missing.`);
  return result;
}
function numberField(value: unknown, key: string): number | undefined {
  const field = objectValue(value)?.[key];
  return typeof field === "number" && Number.isFinite(field)
    ? field
    : undefined;
}
function errorMessage(value: unknown): string {
  return stringField(value, "message")?.slice(0, 500) ?? "unknown error";
}
class WorkerTimeoutError extends Error {}
