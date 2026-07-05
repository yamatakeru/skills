import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AdapterRegistry,
  createContextManifest,
  defaultHarnessSelector,
  defaultPolicies,
  DeterministicSynthesizer,
  FileRunRecorder,
  buildClaudeCodeArgs,
  buildOpenCodeArgs,
  ClaudeCodeHeadlessCliAdapter,
  NoopRunRecorder,
  OpenCodeHeadlessCliAdapter,
  runPanel,
  type CommandExecution,
  type PanelRequest,
  type WorkerRequest,
  type WorkerResult,
  type WorkerRunner,
} from "../lib/protocol";

describe("Fusion harness selection", () => {
  test("defaults to OpenCode when no harness list is provided", () => {
    expect(
      defaultHarnessSelector.selectHarness({
        workerId: "worker-1",
        policy: {},
      }),
    ).toEqual({ kind: "opencode", invocation: "headless" });
  });

  test("prefers Claude Code for Claude-family model preferences when available", () => {
    expect(
      defaultHarnessSelector.selectHarness({
        workerId: "worker-1",
        modelPreference: { provider: "anthropic", model: "claude-sonnet" },
        policy: { availableHarnesses: ["opencode", "claude-code"] },
      }),
    ).toEqual({ kind: "claude-code", invocation: "headless" });
  });

  test("fails when the caller explicitly provides no available harnesses", () => {
    expect(() =>
      defaultHarnessSelector.selectHarness({
        workerId: "worker-1",
        policy: { availableHarnesses: [] },
      }),
    ).toThrow("No harnesses are available");
  });
});

describe("Fusion context manifests", () => {
  test("are stable for equivalent shared context key ordering", () => {
    const left = createContextManifest({
      renderedPrompt: "review this",
      sharedContext: {
        text: "context",
        files: [{ path: "a.ts", content: "export const a = 1;" }],
      },
    });
    const right = createContextManifest({
      renderedPrompt: "review this",
      sharedContext: {
        files: [{ content: "export const a = 1;", path: "a.ts" }],
        text: "context",
      },
    });

    expect(right).toEqual(left);
  });
});

describe("Fusion adapter registry", () => {
  test("derives available harnesses from registered adapters", () => {
    const registry = new AdapterRegistry().register("claude-code", okRunner());

    expect(
      registry.selectHarness({
        workerId: "worker-1",
        modelPreference: { model: "claude-sonnet" },
        policy: {},
      }),
    ).toEqual({ kind: "claude-code", invocation: "headless" });
  });

  test("refuses to select an unregistered explicit harness", () => {
    const registry = new AdapterRegistry().register("opencode", okRunner());

    expect(() =>
      registry.selectHarness({
        workerId: "worker-1",
        policy: { availableHarnesses: ["claude-code"] },
      }),
    ).toThrow("not registered");
  });
});

describe("Fusion headless CLI adapters", () => {
  test("builds OpenCode headless run arguments", () => {
    const request = workerRequest();
    const args = buildOpenCodeArgs(request);

    expect(args.slice(0, 5)).toEqual([
      "run",
      "--format",
      "json",
      "--pure",
      "--model",
    ]);
    expect(args).toContain("openai/gpt-5.5");
  });

  test("builds Claude Code non-interactive stream-json arguments", () => {
    const args = buildClaudeCodeArgs(workerRequest());

    expect(args).toContain("--print");
    expect(args).toContain("stream-json");
    expect(args).toContain("dontAsk");
    expect(args).toContain("Read,Grep,Glob,LS");
  });

  test("maps OpenCode CLI output to a degraded worker result", async () => {
    const executions: CommandExecution[] = [];
    const adapter = new OpenCodeHeadlessCliAdapter({
      executor: async (execution) => {
        executions.push(execution);
        return {
          exitCode: 0,
          stdout: '{"message":"adapter output"}\n',
          stderr: "",
          durationMs: 12,
        };
      },
    });

    const result = await adapter.runWorker(workerRequest());

    expect(executions[0]?.command).toBe("opencode");
    expect(result.status).toBe("ok");
    expect(result.output).toBe("adapter output");
    expect(result.complianceEvidence?.observedToolPolicy).toBeUndefined();
    expect(result.warnings?.[0]).toContain("degraded");
  });

  test("maps Claude Code CLI output with observed tool policy", async () => {
    const adapter = new ClaudeCodeHeadlessCliAdapter({
      executor: async () => ({
        exitCode: 0,
        stdout: '{"result":"claude output"}\n',
        stderr: "",
        durationMs: 9,
      }),
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("ok");
    expect(result.output).toBe("claude output");
    expect(result.complianceEvidence?.observedToolPolicy).toEqual(
      workerRequest().toolsPolicy,
    );
  });

  test("marks malformed CLI JSON as invalid output", async () => {
    const adapter = new ClaudeCodeHeadlessCliAdapter({
      executor: async () => ({
        exitCode: 0,
        stdout: "not json",
        stderr: "",
        durationMs: 1,
      }),
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("invalid-output");
    expect(result.errors?.[0]).toContain("invalid JSON");
  });

  test("marks timed out CLI execution as timeout", async () => {
    const adapter = new ClaudeCodeHeadlessCliAdapter({
      executor: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "",
        durationMs: 1000,
        timedOut: true,
      }),
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("timeout");
    expect(result.errors?.[0]).toContain("timed out");
  });

  test("reports empty successful CLI output", async () => {
    const adapter = new ClaudeCodeHeadlessCliAdapter({
      executor: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1,
      }),
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("error");
    expect(result.errors?.[0]).toContain("no worker output");
  });
});

describe("Fusion panel runtime", () => {
  test("runs workers, records required events, and uses deterministic synthesis", async () => {
    const result = await runPanel(panelRequest(), {
      runner: okRunner(),
      synthesizer: new DeterministicSynthesizer(),
    });

    expect(result.status).toBe("ok");
    expect(result.synthesis).toContain("# Fusion Synthesis");
    expect(result.synthesis).toContain("worker-1 output");
    expect(result.complianceSummary.tier).toBe("full");
    expect(result.events?.map((event) => event.type)).toContain(
      "compliance.evaluated",
    );
  });

  test("downgrades resumed sessions without clean lineage evidence", async () => {
    const result = await runPanel(panelRequest(), {
      runner: okRunner({ sessionMode: "resume" }),
      synthesizer: new DeterministicSynthesizer(),
      defaults: { session: { mode: "resume", reusePolicy: "none" } },
    });

    expect(result.complianceSummary.tier).toBe("degraded");
    expect(
      result.complianceSummary.workerCompliance[0]?.compliance.degradedReason,
    ).toContain("resumed session clean lineage not proven");
  });

  test("skips synthesis when partial synthesis is disabled and a worker fails", async () => {
    const result = await runPanel(
      panelRequest({ synthesisAllowPartial: false }),
      {
        runner: mixedRunner(),
        synthesizer: new DeterministicSynthesizer(),
      },
    );

    expect(result.status).toBe("failed");
    expect(result.synthesis).toBe("");
    expect(result.errors?.[0]).toContain("partial synthesis is disabled");
  });
});

describe("Fusion run recorders", () => {
  test("no-op recorder does not record", () => {
    expect(new NoopRunRecorder().status).toBe("not-recorded");
  });

  test("file recorder writes split artifacts with redaction", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "fusion-recorder-"));
    await writeFile(join(workspaceRoot, ".gitignore"), ".fusion-runs/\n");
    try {
      const request = panelRequest({ panelRunId: "recorded-run" });
      const recorder = new FileRunRecorder({
        workspaceRoot,
        panelRunId: request.panelRunId,
      });

      await runPanel(request, {
        runner: okRunner(),
        synthesizer: new DeterministicSynthesizer(),
        recorder,
      });

      const runDirectory = join(workspaceRoot, ".fusion-runs", "recorded-run");
      const requestJson = await readFile(
        join(runDirectory, "request.json"),
        "utf8",
      );
      const synthesisJson = await readFile(
        join(runDirectory, "synthesis.json"),
        "utf8",
      );
      const eventsJsonl = await readFile(
        join(runDirectory, "events.jsonl"),
        "utf8",
      );

      expect(recorder.status).toBe("complete");
      expect(requestJson).toContain("[REDACTED]");
      expect(requestJson).not.toContain("do-not-write");
      expect(synthesisJson).toContain("deterministic");
      expect(eventsJsonl).toContain("panel.started");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("file recorder requires git-ignore safety unless explicitly overridden", async () => {
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), "fusion-recorder-unsafe-"),
    );
    try {
      const recorder = new FileRunRecorder({
        workspaceRoot,
        panelRunId: "unsafe-run",
      });

      await expect(recorder.recordRequest(panelRequest())).rejects.toThrow(
        "not git-ignored",
      );
      expect(recorder.status).toBe("failed");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("file recorder rejects unsafe panel run ids", () => {
    expect(
      () =>
        new FileRunRecorder({
          workspaceRoot: "/tmp",
          panelRunId: "../escape",
        }),
    ).toThrow("safe path segment");
  });

  test("file recorder requires explicit override for custom root directories", () => {
    expect(
      () =>
        new FileRunRecorder({
          workspaceRoot: "/tmp",
          panelRunId: "safe-run",
          rootDirectory: "/tmp/custom-fusion-runs",
        }),
    ).toThrow("allowUnignoredDirectory");
  });

  test("file recorder redacts common secret string formats", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "fusion-redaction-"));
    await writeFile(join(workspaceRoot, ".gitignore"), ".fusion-runs/\n");
    try {
      const request = panelRequest({ panelRunId: "redacted-run" });
      request.sharedContext.text = [
        "Authorization: Bearer bearer-secret-value",
        "OPENAI_API_KEY=sk-1234567890abcdef",
        "GITHUB_TOKEN=ghp_1234567890abcdef",
      ].join("\n");
      const recorder = new FileRunRecorder({
        workspaceRoot,
        panelRunId: request.panelRunId,
      });

      await recorder.recordRequest(request);

      const requestJson = await readFile(
        join(workspaceRoot, ".fusion-runs", "redacted-run", "request.json"),
        "utf8",
      );
      expect(requestJson).not.toContain("bearer-secret-value");
      expect(requestJson).not.toContain("sk-1234567890abcdef");
      expect(requestJson).not.toContain("ghp_1234567890abcdef");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

function panelRequest(
  options: { panelRunId?: string; synthesisAllowPartial?: boolean } = {},
): PanelRequest {
  const sharedContext = {
    text: "shared",
    references: [{ label: "env", uri: "token=do-not-write" }],
  };
  return {
    panelRunId: options.panelRunId ?? "panel-run-1",
    prompt: "Answer independently.",
    sharedContext,
    contextManifest: createContextManifest({
      renderedPrompt: "Answer independently.",
      sharedContext,
    }),
    panelSpec: { workerCount: 2 },
    harnessSelectionPolicy: { availableHarnesses: ["opencode"] },
    synthesisContract: {
      requiredFindings: ["consensus", "contradictions", "blind-spots"],
      format: "markdown",
      allowPartial: options.synthesisAllowPartial ?? true,
      requireAttribution: true,
    },
    provenancePolicy: defaultPolicies.provenance,
  };
}

function workerRequest(): WorkerRequest {
  const [request] = buildWorkerRequestsForTest();
  if (request === undefined) {
    throw new Error("Expected test worker request.");
  }
  return {
    ...request,
    modelPreference: { provider: "openai", model: "gpt-5.5" },
    environment: { workspaceRoot: "/workspace" },
  };
}

function buildWorkerRequestsForTest(): WorkerRequest[] {
  const request = panelRequest();
  return [
    {
      panelRunId: request.panelRunId,
      workerId: "worker-1",
      prompt: request.prompt,
      sharedContext: request.sharedContext,
      contextManifest: request.contextManifest,
      harness: { kind: "opencode", invocation: "headless" },
      session: defaultPolicies.session,
      isolationPolicy: defaultPolicies.isolation,
      blindnessPolicy: defaultPolicies.blindness,
      workerPolicy: defaultPolicies.worker,
      toolsPolicy: defaultPolicies.tools,
      outputContract: defaultPolicies.output,
      provenancePolicy: defaultPolicies.provenance,
    },
  ];
}

function okRunner(
  options: { sessionMode?: "fresh" | "resume" } = {},
): WorkerRunner {
  return {
    async runWorker(request: WorkerRequest): Promise<WorkerResult> {
      return okWorkerResult(request, options.sessionMode);
    },
  };
}

function mixedRunner(): WorkerRunner {
  return {
    async runWorker(request: WorkerRequest): Promise<WorkerResult> {
      if (request.workerId === "worker-2") {
        throw new Error("boom");
      }
      return okWorkerResult(request);
    },
  };
}

function okWorkerResult(
  request: WorkerRequest,
  sessionMode: "fresh" | "resume" = "fresh",
): WorkerResult {
  return {
    panelRunId: request.panelRunId,
    workerId: request.workerId,
    status: "ok",
    output: `${request.workerId} output`,
    harnessUsed: harnessUsedFor(request),
    complianceEvidence: {
      adapterClaimsIndependentInvocation: true,
      adapterClaimsIsolatedContext: true,
      adapterClaimsBlindness: true,
      observedSessionMode: sessionMode,
      observedToolPolicy: request.toolsPolicy,
    },
  };
}

function harnessUsedFor(request: WorkerRequest): WorkerResult["harnessUsed"] {
  if (
    request.harness?.kind === undefined ||
    request.harness.invocation === undefined
  ) {
    return undefined;
  }

  return {
    kind: request.harness.kind,
    invocation: request.harness.invocation,
    version: request.harness.version,
  };
}
