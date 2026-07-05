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
  buildWorkerRequests,
  buildClaudeCodeArgs,
  buildOpenCodeArgs,
  ClaudeCodeHeadlessCliAdapter,
  NoopRunRecorder,
  OpenCodeHeadlessCliAdapter,
  renderWorkerPrompt,
  resolvePanelComposition,
  runPanel,
  stableDigest,
  type CommandExecutor,
  type CommandExecution,
  type PanelRequest,
  type WorkerRequest,
  type WorkerResult,
  type WorkerRunner,
} from "../lib/protocol";
import {
  buildSharedContext,
  parseArgs,
  preparePanelRequest,
} from "../bin/fusion-run";

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

  test("hash rendered prompts and digest embedded context files", () => {
    const sharedContext = {
      text: "context",
      files: [{ path: "a.ts", content: "export const a = 1;" }],
    };
    const renderedPrompt = renderWorkerPrompt({
      task: "review this",
      outputContract: defaultPolicies.output,
      sharedContext,
    });
    const manifest = createContextManifest({
      renderedPrompt,
      userTask: "review this",
      sharedContext,
    });

    expect(manifest.renderedPromptHash).toBe(stableDigest(renderedPrompt));
    expect(manifest.userTaskHash).toBe(stableDigest("review this"));
    expect(manifest.files).toEqual([
      { path: "a.ts", digest: stableDigest("export const a = 1;") },
    ]);
  });
});

describe("Fusion worker prompt rendering", () => {
  test("renders portable instructions, contract sections, and shared context", () => {
    const sharedContext = {
      text: "use this project context",
      files: [{ path: "notes.md", content: "file-backed context" }],
    };
    const outputContract = {
      ...defaultPolicies.output,
      requiredSections: ["Decision", "Evidence"],
    };
    const renderedPrompt = renderWorkerPrompt({
      task: "Answer the task as given.",
      outputContract,
      sharedContext,
    });

    expect(renderedPrompt).toContain("neutral independent panelist");
    expect(renderedPrompt).toContain(
      "Treat the task as given; do not rewrite it",
    );
    expect(renderedPrompt).toContain("1. Decision");
    expect(renderedPrompt).toContain("2. Evidence");
    expect(renderedPrompt).not.toContain("What I would verify next");
    expect(renderedPrompt).toContain("use this project context");
    expect(renderedPrompt).toContain("File: notes.md");
    expect(renderedPrompt).toContain("file-backed context");
  });

  test("renders schema name when the output contract provides one", () => {
    const renderedPrompt = renderWorkerPrompt({
      task: "Return structured output.",
      outputContract: {
        ...defaultPolicies.output,
        schemaName: "FusionWorkerAnswer",
      },
      sharedContext: { text: "shared" },
    });

    expect(renderedPrompt).toContain(
      "Format: markdown\nSchema: FusionWorkerAnswer",
    );
  });

  test("worker request construction renders once and adapters pass prompt verbatim", () => {
    const sharedContext = {
      text: "shared rendering context",
      files: [{ path: "brief.txt", content: "embedded brief" }],
    };
    const outputContract = {
      ...defaultPolicies.output,
      requiredSections: ["Only Section"],
    };
    const panel = {
      ...panelRequest(),
      prompt: "Raw task",
      sharedContext,
      contextManifest: createContextManifest({
        renderedPrompt: renderWorkerPrompt({
          task: "Raw task",
          outputContract,
          sharedContext,
        }),
        sharedContext,
      }),
    };
    const [worker] = buildWorkerRequests(panel, { output: outputContract });

    expect(worker?.prompt).toBe(
      renderWorkerPrompt({
        task: "Raw task",
        outputContract,
        sharedContext,
      }),
    );
    const openCodeArgs = buildOpenCodeArgs(workerRequestFrom(worker));
    const claudeArgs = buildClaudeCodeArgs(workerRequestFrom(worker));
    expect(openCodeArgs[openCodeArgs.length - 1]).toBe(worker?.prompt);
    expect(claudeArgs[claudeArgs.length - 1]).toBe(worker?.prompt);
  });

  test("CLI-prepared manifests prove the rendered prompt and context file digests", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "fusion-context-"));
    await writeFile(join(workspaceRoot, "context.txt"), "embedded context");
    try {
      const options = parseArgs([
        "--models",
        "claude-code:sonnet",
        "--context",
        "short brief",
        "--context-file",
        "context.txt",
        "Investigate this.",
      ]);
      const prepared = await preparePanelRequest(options, {
        cwd: workspaceRoot,
        panelRunId: "context-run",
      });
      const expectedRenderedPrompt = workerRequestFrom(
        prepared.workerRequests[0],
      ).prompt;

      expect(prepared.request.sharedContext.text).toContain(
        `Workspace root: ${workspaceRoot}`,
      );
      expect(prepared.request.sharedContext.text).toContain("short brief");
      expect(prepared.request.sharedContext.files).toEqual([
        { path: "context.txt", content: "embedded context" },
      ]);
      expect(prepared.request.contextManifest.renderedPromptHash).toBe(
        stableDigest(expectedRenderedPrompt),
      );
      expect(prepared.workerRequests[0]?.contextManifest).toEqual(
        prepared.request.contextManifest,
      );
      expect(prepared.request.contextManifest.files).toEqual([
        { path: "context.txt", digest: stableDigest("embedded context") },
      ]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
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

describe("Fusion CLI parsing", () => {
  test("parses shared context, reasoning, and turn budget flags", () => {
    const options = parseArgs([
      "--context",
      "brief",
      "--context-file",
      "a.md",
      "--context-file=b.md",
      "--effort",
      "high",
      "--reasoning-max-tokens",
      "1234",
      "--max-turns",
      "5",
      "--timeout-ms",
      "60000",
      "Do work",
    ]);

    expect(options.context).toBe("brief");
    expect(options.contextFiles).toEqual(["a.md", "b.md"]);
    expect(options.reasoning).toEqual({ effort: "high", maxTokens: 1234 });
    expect(options.maxTurns).toBe(5);
    expect(options.timeoutMs).toBe(60000);
    expect(options.prompt).toBe("Do work");
  });

  test("rejects invalid new CLI flag values", () => {
    expect(() => parseArgs(["--effort", "max", "task"])).toThrow(
      "low, medium, high, xhigh",
    );
    expect(() => parseArgs(["--reasoning-max-tokens", "0", "task"])).toThrow(
      "positive integer",
    );
    expect(() => parseArgs(["--max-turns", "0", "task"])).toThrow(
      "positive integer",
    );
    expect(() => parseArgs(["--context-file", "task"])).toThrow(
      "Fusion requires a task prompt",
    );
  });

  test("warns but keeps oversized embedded shared context", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "fusion-large-"));
    const largeContext = "x".repeat(256 * 1024 + 1);
    await writeFile(join(workspaceRoot, "large.txt"), largeContext);
    try {
      const options = parseArgs([
        "--context-file",
        "large.txt",
        "Use context.",
      ]);
      const result = await buildSharedContext(options, workspaceRoot);

      expect(result.sharedContext.files?.[0]?.content).toBe(largeContext);
      expect(result.warnings.join("\n")).toContain("exceeding");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
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
    expect(args[args.length - 1]).toBe(request.prompt);
  });

  test("maps OpenCode reasoning effort through model variant", () => {
    const request = {
      ...workerRequest(),
      reasoning: { effort: "xhigh" as const },
    };
    const args = buildOpenCodeArgs(request);

    expect(args).toContain("--variant");
    expect(args).toContain("max");
    expect(args[args.length - 1]).toBe(request.prompt);
  });

  test("builds Claude Code non-interactive stream-json arguments", () => {
    const request = {
      ...workerRequest(),
      modelPreference: { model: "sonnet", fallbacks: ["haiku"] },
      reasoning: { effort: "high" as const },
    };
    const args = buildClaudeCodeArgs(request);

    expect(args).toEqual([
      "--print",
      "--verbose",
      "--output-format",
      "stream-json",
      "--permission-mode",
      "dontAsk",
      "--no-session-persistence",
      "--model",
      "sonnet",
      "--fallback-model",
      "haiku",
      "--effort",
      "high",
      "--tools=Read,Grep,Glob,LS,WebSearch,WebFetch,Bash",
      "--allowedTools=Read,Grep,Glob,LS,WebSearch,WebFetch,Bash(git status:*),Bash(git diff:*),Bash(git log:*),Bash(rg:*),Bash(grep:*),Bash(ls:*),Bash(cat:*)",
      "--disallowedTools=Write,Edit,MultiEdit,Task,NotebookEdit",
      request.prompt,
    ]);
  });

  test("does not emit unsupported Claude Code max-turns or reasoning token flags", () => {
    const request = {
      ...workerRequest(),
      reasoning: { maxTokens: 8000 },
      budget: { maxTurns: 2 },
    };
    const args = buildClaudeCodeArgs(request);

    expect(args).not.toContain("--max-turns");
    expect(args).not.toContain("--reasoning-max-tokens");
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

  test("warns when OpenCode cannot map reasoning max tokens or turn caps", async () => {
    const adapter = new OpenCodeHeadlessCliAdapter({
      executor: async () => ({
        exitCode: 0,
        stdout: '{"message":"adapter output"}\n',
        stderr: "",
        durationMs: 12,
      }),
    });

    const result = await adapter.runWorker({
      ...workerRequest(),
      reasoning: { effort: "medium", maxTokens: 3000 },
      budget: { maxTurns: 3 },
    });

    expect(result.status).toBe("ok");
    expect(result.warnings?.join("\n")).toContain("reasoning.maxTokens");
    expect(result.warnings?.join("\n")).toContain("maxTurns=3");
    expect(result.complianceEvidence?.notes?.join("\n")).toContain(
      "opencode --variant medium",
    );
  });

  test("maps OpenCode observed text part events to worker output", async () => {
    const adapter = new OpenCodeHeadlessCliAdapter({
      executor: async () => ({
        exitCode: 0,
        stdout:
          '{"type":"text","part":{"type":"text","text":"fusion-smoke-ok"}}\n',
        stderr: "",
        durationMs: 7,
      }),
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("ok");
    expect(result.output).toBe("fusion-smoke-ok");
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

  test("warns when Claude Code cannot map reasoning max tokens or turn caps", async () => {
    const adapter = new ClaudeCodeHeadlessCliAdapter({
      executor: async () => ({
        exitCode: 0,
        stdout: '{"result":"claude output"}\n',
        stderr: "",
        durationMs: 9,
      }),
    });

    const result = await adapter.runWorker({
      ...workerRequest(),
      reasoning: { effort: "low", maxTokens: 3000 },
      budget: { maxTurns: 3 },
    });

    expect(result.status).toBe("ok");
    expect(result.warnings?.join("\n")).toContain("reasoning.maxTokens");
    expect(result.warnings?.join("\n")).toContain("maxTurns=3");
    expect(result.complianceEvidence?.notes?.join("\n")).toContain(
      "claude --effort low",
    );
  });

  test("prefers Claude Code final result text over intermediate assistant text", async () => {
    const adapter = new ClaudeCodeHeadlessCliAdapter({
      executor: async () => ({
        exitCode: 0,
        stdout: [
          JSON.stringify({
            type: "assistant",
            part: {
              type: "text",
              text: "十分な証拠が揃いました。回答をまとめます。",
            },
          }),
          JSON.stringify({
            type: "result",
            result: "final answer only",
          }),
        ].join("\n"),
        stderr: "",
        durationMs: 9,
      }),
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("ok");
    expect(result.output).toBe("final answer only");
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

describe("Fusion panel composition", () => {
  test("builds the default parent, flagship, and budget slots", async () => {
    const composition = await resolvePanelComposition({
      parentModel: "sonnet",
      executor: opencodeModelsExecutor([
        "openai/gpt-5.5",
        "opencode/deepseek-v4-flash-free",
      ]),
    });

    expect(composition.panelSpec.workerCount).toBe(3);
    expect(composition.panelSpec.parentModel).toEqual({
      model: "sonnet",
      fallbacks: ["haiku"],
    });
    expect(
      composition.resolvedModels.map((model) => model.resolvedModelId),
    ).toEqual(["sonnet", "openai/gpt-5.5", "opencode/deepseek-v4-flash-free"]);
    expect(
      composition.harnessSelectionPolicy.userPolicy?.fusionForcedHarnesses,
    ).toEqual({
      "worker-1": "claude-code",
      "worker-2": "opencode",
      "worker-3": "opencode",
    });
  });

  test("warns and refills when the parent model is omitted", async () => {
    const composition = await resolvePanelComposition({
      executor: opencodeModelsExecutor([
        "openai/gpt-5.5",
        "openai/gpt-5.5-fast",
        "opencode/deepseek-v4-flash-free",
      ]),
    });

    expect(composition.warnings.join("\n")).toContain("No --parent-model");
    expect(
      new Set(composition.resolvedModels.map((model) => model.resolvedModelId))
        .size,
    ).toBe(3);
    expect(
      composition.resolvedModels.map((model) => model.resolvedModelId),
    ).toEqual([
      "openai/gpt-5.5",
      "opencode/deepseek-v4-flash-free",
      "openai/gpt-5.5-fast",
    ]);
  });

  test("dedupes default model ids and refills from fallback entries", async () => {
    const composition = await resolvePanelComposition({
      parentModel: "openai/gpt-5.5",
      executor: opencodeModelsExecutor([
        "openai/gpt-5.5",
        "openai/gpt-5.4",
        "opencode/deepseek-v4-flash-free",
      ]),
    });

    expect(
      composition.resolvedModels.map((model) => model.resolvedModelId),
    ).toEqual([
      "openai/gpt-5.5",
      "openai/gpt-5.4",
      "opencode/deepseek-v4-flash-free",
    ]);
  });

  test("keeps duplicate models only for explicit selection", async () => {
    const composition = await resolvePanelComposition({
      models: [
        "opencode:opencode/deepseek-v4-flash-free",
        "opencode:opencode/deepseek-v4-flash-free",
      ],
      executor: opencodeModelsExecutor(["opencode/deepseek-v4-flash-free"]),
    });

    expect(composition.panelSpec.workerCount).toBe(2);
    expect(
      composition.resolvedModels.map((model) => model.resolvedModelId),
    ).toEqual([
      "opencode/deepseek-v4-flash-free",
      "opencode/deepseek-v4-flash-free",
    ]);
  });

  test("rejects unrecognized model entries instead of guessing", async () => {
    await expect(
      resolvePanelComposition({ models: ["mystery-model"] }),
    ).rejects.toThrow("Unrecognized Fusion model entry");
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

  test("parent-agent strategy keeps synthesis but unsets the final answer", async () => {
    const result = await runPanel(
      { ...panelRequest(), synthesizer: { strategy: "parent-agent" } },
      {
        runner: okRunner(),
        synthesizer: new DeterministicSynthesizer(),
      },
    );

    expect(result.synthesis).toContain("# Fusion Synthesis");
    expect(result.finalAnswer).toBeUndefined();
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
  const prompt = "Answer independently.";
  return {
    panelRunId: options.panelRunId ?? "panel-run-1",
    prompt,
    sharedContext,
    contextManifest: createContextManifest({
      renderedPrompt: renderWorkerPrompt({
        task: prompt,
        outputContract: defaultPolicies.output,
        sharedContext,
      }),
      userTask: prompt,
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

function opencodeModelsExecutor(models: string[]): CommandExecutor {
  return async (execution: CommandExecution) => {
    expect(execution.command).toBe("opencode");
    expect(execution.args).toEqual(["models"]);
    return {
      exitCode: 0,
      stdout: `${models.join("\n")}\n`,
      stderr: "",
      durationMs: 1,
    };
  };
}

function buildWorkerRequestsForTest(): WorkerRequest[] {
  return buildWorkerRequests(panelRequest());
}

function workerRequestFrom(request: WorkerRequest | undefined): WorkerRequest {
  if (request === undefined) {
    throw new Error("Expected test worker request.");
  }
  return request;
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
