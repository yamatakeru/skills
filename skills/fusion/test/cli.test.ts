import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSharedContext,
  createFusionRuntime,
  parseArgs,
  preparePanelRequest,
  renderMarkdownReport,
} from "../bin/fusion-run";
import {
  ClaudeCodeHeadlessCliAdapter,
  ClaudeCodeSdkAdapter,
  OpenCodeHeadlessCliAdapter,
  OpenCodeSdkAdapter,
  type PanelResult,
} from "../lib/protocol";

describe("Fusion CLI parsing", () => {
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
