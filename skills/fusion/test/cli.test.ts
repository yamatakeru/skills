import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDryRunReport,
  buildSharedContext,
  createFusionRuntime,
  parseArgs,
  preparePanelRequest,
  renderDryRunReport,
  renderMarkdownReport,
  UsageError,
} from "../bin/fusion-run";
import {
  ClaudeCodeHeadlessCliAdapter,
  ClaudeCodeSdkAdapter,
  CursorSdkAdapter,
  OpenCodeHeadlessCliAdapter,
  OpenCodeSdkAdapter,
  type PanelResult,
} from "../lib/protocol";

describe("Fusion CLI parsing", () => {
  test("parses dry-run", () => {
    const options = parseArgs(["--dry-run", "Preflight this."]);

    expect(options.dryRun).toBe(true);
    expect(options.prompt).toBe("Preflight this.");
  });

  test("parses shared context, transport, read roots, judge model, and turn budget flags", () => {
    const options = parseArgs([
      "--context",
      "brief",
      "--context-file",
      "a.md",
      "--context-file=b.md",
      "--read-root",
      "../external",
      "--effort",
      "high",
      "--reasoning-max-tokens",
      "1234",
      "--max-turns",
      "5",
      "--judge-model",
      "claude-code:sonnet",
      "--timeout-ms",
      "60000",
      "--transport",
      "cli",
      "Do work",
    ]);

    expect(options.context).toBe("brief");
    expect(options.contextFiles).toEqual(["a.md", "b.md"]);
    expect(options.readRoots).toEqual(["../external"]);
    expect(options.reasoning).toEqual({ effort: "high", maxTokens: 1234 });
    expect(options.maxTurns).toBe(5);
    expect(options.judgeModel).toBe("claude-code:sonnet");
    expect(options.timeoutMs).toBe(60000);
    expect(options.transport).toBe("cli");
    expect(options.prompt).toBe("Do work");
  });

  test("defaults to SDK transport", () => {
    const options = parseArgs(["Do work"]);

    expect(options.transport).toBe("sdk");
  });

  test("rejects option-like tokens after the task prompt", () => {
    const parse = () => parseArgs(["--dry-run", "task", "--record"]);

    expect(parse).toThrow(UsageError);
    expect(parse).toThrow(
      'Unexpected option-like token after the task prompt: "--record". Place options before the prompt, or start the invocation with "--" to pass a literal prompt containing "--".',
    );
  });

  test("rejects a separator after the task prompt as option-like", () => {
    const parse = () => parseArgs(["task", "--", "--record"]);

    expect(parse).toThrow(UsageError);
    expect(parse).toThrow(
      'Unexpected option-like token after the task prompt: "--". Place options before the prompt, or start the invocation with "--" to pass a literal prompt containing "--".',
    );
  });

  test("parses an unquoted multi-word task prompt", () => {
    const options = parseArgs(["foo", "bar", "baz"]);

    expect(options.prompt).toBe("foo bar baz");
  });

  test("parses option-like prompt text after the separator verbatim", () => {
    const options = parseArgs(["--", "--record", "looks", "like", "a", "flag"]);

    expect(options.prompt).toBe("--record looks like a flag");
  });

  test("allows double hyphens in the middle of a prompt token", () => {
    const options = parseArgs(["task", "a--b"]);

    expect(options.prompt).toBe("task a--b");
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
    expect(() => parseArgs(["--transport", "api", "task"])).toThrow(
      "sdk, cli",
    );
  });

  test("rejects inline values on boolean flags", () => {
    expect(() => parseArgs(["--record=false", "task"])).toThrow(
      "does not take a value",
    );
    expect(() => parseArgs(["--json=true", "task"])).toThrow(
      "does not take a value",
    );
    expect(() => parseArgs(["--dry-run=true", "task"])).toThrow(
      "does not take a value",
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

  test("maps default judge preference to the parent model", async () => {
    const options = parseArgs([
      "--parent-model",
      "sonnet",
      "--models",
      "claude-code:sonnet",
      "Use the parent model for judging.",
    ]);

    const prepared = await preparePanelRequest(options, {
      cwd: "/tmp",
      panelRunId: "judge-parent",
    });

    expect(prepared.request.synthesizer).toEqual({
      strategy: "claude-code",
      model: { model: "sonnet", fallbacks: ["haiku"] },
    });
  });

  test("maps --judge-model through model-entry routing", async () => {
    const options = parseArgs([
      "--models",
      "claude-code:sonnet",
      "--judge-model",
      "claude-code:haiku",
      "Use an explicit judge.",
    ]);

    const prepared = await preparePanelRequest(options, {
      cwd: "/tmp",
      panelRunId: "judge-explicit",
    });

    expect(prepared.request.synthesizer).toEqual({
      strategy: "claude-code",
      model: { model: "haiku", fallbacks: [] },
    });
  });

  test("allows explicit cursor judge strategy without an implicit judge model", async () => {
    const options = parseArgs([
      "--models",
      "claude-code:sonnet",
      "--synthesizer",
      "cursor",
      "Use Cursor for judging.",
    ]);

    const prepared = await preparePanelRequest(options, {
      cwd: "/tmp",
      panelRunId: "judge-cursor",
    });

    expect(prepared.request.synthesizer).toEqual({ strategy: "cursor" });
    expect(prepared.warnings.join("\n")).toContain(
      "No --parent-model or --judge-model",
    );
  });

  test("rejects cursor selection under CLI transport", async () => {
    const options = parseArgs([
      "--transport",
      "cli",
      "--models",
      "cursor:composer-2.5-fast",
      "Use Cursor.",
    ]);

    await expect(
      preparePanelRequest(options, {
        cwd: "/tmp",
        panelRunId: "cursor-transport",
      }),
    ).rejects.toThrow("requires --transport sdk");
  });

  test("builds a dry-run report with the mode discriminator", async () => {
    const options = parseArgs([
      "--dry-run",
      "--json",
      "--models",
      "claude-code:sonnet",
      "--judge-model",
      "claude-code:haiku",
      "Preflight this.",
    ]);
    const prepared = await preparePanelRequest(options, {
      cwd: "/tmp",
      panelRunId: "dry-run-shape",
    });
    const report = buildDryRunReport(options, prepared);

    expect(report).toEqual({
      mode: "dry-run",
      panelRunId: "dry-run-shape",
      transport: "sdk",
      resolvedModels: [
        {
          slot: "explicit",
          entry: "claude-code:sonnet",
          kind: "tier-alias",
          harness: "claude-code",
          resolvedModelId: "sonnet",
          fallbacks: ["haiku"],
          validatedBy: "pattern",
        },
      ],
      judge: {
        strategy: "claude-code",
        modelEntry: "claude-code:haiku",
        harness: "claude-code",
      },
      manifest: {
        renderedPromptHash:
          prepared.request.contextManifest.renderedPromptHash,
        sharedContextHash: prepared.request.contextManifest.sharedContextHash,
      },
      warnings: [],
    });
  });

  test("renders a clearly labeled dry-run report", async () => {
    const options = parseArgs([
      "--dry-run",
      "--models",
      "claude-code:sonnet",
      "Preflight this.",
    ]);
    const prepared = await preparePanelRequest(options, {
      cwd: "/tmp",
      panelRunId: "dry-run-render",
    });
    const report = renderDryRunReport(buildDryRunReport(options, prepared));

    expect(report).toContain("# Fusion Dry-Run Preflight");
    expect(report).toContain("no workers or judge were invoked");
    expect(report).toContain("| explicit | claude-code:sonnet | tier-alias |");
  });

  test("dry-run json exits 0 and emits DryRunReport JSON", () => {
    const result = runFusionCli([
      "--dry-run",
      "--json",
      "--models",
      "claude-code:sonnet",
      "Preflight this.",
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout);
    expect(report.mode).toBe("dry-run");
    expect(report.resolvedModels[0]).toMatchObject({
      entry: "claude-code:sonnet",
      kind: "tier-alias",
      validatedBy: "pattern",
    });
  });

  test("dry-run exits 1 with the real diagnostic on preparation failure", () => {
    const result = runFusionCli([
      "--dry-run",
      "--transport",
      "cli",
      "--models",
      "cursor:composer-2.5-fast",
      "Preflight this.",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Cursor model entry "cursor:composer-2.5-fast" requires --transport sdk',
    );
    expect(result.stdout).toBe("");
  });

  test("record with dry-run warns and records nothing", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "fusion-dry-run-"));
    try {
      const result = runFusionCli(
        [
          "--dry-run",
          "--record",
          "--models",
          "claude-code:sonnet",
          "Preflight this.",
        ],
        workspaceRoot,
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        "Dry run writes no artifacts; --record has no effect.",
      );
      expect(existsSync(join(workspaceRoot, ".fusion-runs"))).toBe(false);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("dry-run still requires a prompt", () => {
    expect(() => parseArgs(["--dry-run"])).toThrow(
      "Fusion requires a task prompt",
    );
    const result = runFusionCli(["--dry-run"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Fusion requires a task prompt.");
  });

  test("resolves read roots into worker environment", async () => {
    const options = parseArgs([
      "--models",
      "claude-code:sonnet",
      "--read-root",
      "../outside",
      "Use declared root.",
    ]);

    const prepared = await preparePanelRequest(options, {
      cwd: "/tmp/workspace",
      panelRunId: "read-root",
    });

    expect(prepared.workerRequests[0]?.environment?.readRoots).toEqual([
      "/tmp/outside",
    ]);
    expect(prepared.workerRequests[0]?.harness?.transport).toBe("sdk");
  });

  test("creates SDK adapters by default and CLI adapters on request", async () => {
    const sdkRuntime = createFusionRuntime("sdk");
    const cliRuntime = createFusionRuntime("cli");
    try {
      expect(sdkRuntime.runners.opencode).toBeInstanceOf(OpenCodeSdkAdapter);
      expect(sdkRuntime.runners.claudeCode).toBeInstanceOf(ClaudeCodeSdkAdapter);
      expect(sdkRuntime.runners.cursor).toBeInstanceOf(CursorSdkAdapter);
      expect(cliRuntime.runners.opencode).toBeInstanceOf(
        OpenCodeHeadlessCliAdapter,
      );
      expect(cliRuntime.runners.claudeCode).toBeInstanceOf(
        ClaudeCodeHeadlessCliAdapter,
      );
      expect(
        sdkRuntime.registry.selectHarness({
          workerId: "worker-1",
          policy: {},
        }),
      ).toEqual({
        kind: "opencode",
        invocation: "headless",
          transport: "sdk",
      });
      expect(
        sdkRuntime.registry.selectHarness({
          workerId: "worker-1",
          harnessPreference: { kind: "cursor", invocation: "headless" },
          policy: { availableHarnesses: ["cursor"] },
        }),
      ).toEqual({
        kind: "cursor",
        invocation: "headless",
        transport: "sdk",
      });
    } finally {
      await sdkRuntime.dispose();
      await cliRuntime.dispose();
    }
  });

  test("renders validation fallback as judge invocation ok but output failed", () => {
    const result: PanelResult = {
      panelRunId: "judge-validation-fallback",
      status: "ok",
      workerResults: [],
      synthesis: "# Fusion Synthesis",
      strategy: "parent-agent",
      fallbackReason: "missing keys: contradictions",
      complianceSummary: {
        tier: "full",
        workerCompliance: [],
        judgeCompliance: {
          workerId: "judge",
          status: "ok",
          modelUsed: "fable",
          harnessUsed: { kind: "claude-code", invocation: "headless" },
        },
      },
    };

    const report = renderMarkdownReport(result, {
      recordingStatus: "not-recorded",
      synthesizer: "claude-code",
    });

    expect(report).toContain(
      "- Judge: invocation ok, output failed validation (fell back to parent-agent) via claude-code (fable)",
    );
    expect(report).not.toContain("- Judge: ok via");
  });
});

function runFusionCli(
  args: string[],
  cwd: string = "/tmp",
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [fusionRunPath(), ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function fusionRunPath(): string {
  return join(import.meta.dir, "..", "bin", "fusion-run.ts");
}
