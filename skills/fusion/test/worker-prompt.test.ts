import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildClaudeCodeArgs,
  buildOpenCodeArgs,
  buildWorkerRequests,
  createContextManifest,
  defaultPolicies,
  renderWorkerPrompt,
  stableDigest,
} from "../lib/protocol";
import { parseArgs, preparePanelRequest } from "../bin/fusion-run";
import { panelRequest, workerRequestFrom } from "./fixtures";

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
