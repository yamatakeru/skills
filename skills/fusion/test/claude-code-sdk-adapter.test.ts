import { describe, expect, test } from "bun:test";
import {
  ClaudeCodeSdkAdapter,
  buildClaudeCodeSdkArgs,
  type CommandExecution,
} from "../lib/protocol";
import { withFusionPanelDepth, workerRequest } from "./fixtures";

describe("Fusion Claude Code SDK adapter", () => {
  for (const [label, parentDepth, expectedDepth] of [
    ["defaults an absent panel depth to 0", undefined, "1"],
    ["increments an inherited panel depth", "1", "2"],
  ] as const) {
    test(`${label} for spawned workers`, async () => {
      await withFusionPanelDepth(parentDepth, async () => {
        let execution: CommandExecution | undefined;
        const adapter = new ClaudeCodeSdkAdapter({
          executor: async (input) => {
            execution = input;
            return {
              exitCode: 0,
              stdout: streamJson([{ type: "result", result: "ok" }]),
              stderr: "",
              durationMs: 1,
            };
          },
        });

        await adapter.runWorker(workerRequest());

        expect(execution?.env?.FUSION_PANEL_DEPTH).toBe(expectedDepth);
      });
    });
  }

  test("adds read roots with --add-dir", () => {
    const request = {
      ...workerRequest(),
      environment: {
        workspaceRoot: "/workspace",
        readRoots: ["/external/a", "/external/b"],
      },
    };

    const args = buildClaudeCodeSdkArgs(request);

    expect(args).toContain("--add-dir");
    expect(args).toContain("/external/a");
    expect(args).toContain("/external/b");
    expect(args[args.length - 1]).toBe(request.prompt);
  });

  test("parses stream-json init and result evidence", async () => {
    const executions: CommandExecution[] = [];
    const adapter = new ClaudeCodeSdkAdapter({
      executor: async (execution) => {
        executions.push(execution);
        return {
          exitCode: 0,
          stdout: streamJson([
            {
              type: "system",
              subtype: "init",
              session_id: "claude-session-1",
              model: "claude-sonnet-4-5",
            },
            {
              type: "assistant",
              message: {
                content: [{ type: "text", text: "intermediate" }],
              },
            },
            {
              type: "result",
              subtype: "success",
              is_error: false,
              session_id: "claude-session-1",
              duration_ms: 1234,
              num_turns: 2,
              total_cost_usd: 0.04,
              usage: {
                input_tokens: 11,
                output_tokens: 22,
              },
              result: "final result",
              permission_denials: [],
            },
          ]),
          stderr: "",
          durationMs: 99,
        };
      },
    });

    const result = await adapter.runWorker(workerRequest());

    expect(executions[0]?.command).toBe("claude");
    expect(result.status).toBe("ok");
    expect(result.output).toBe("final result");
    expect(result.modelUsed).toBe("claude-sonnet-4-5");
    expect(result.sessionId).toBe("claude-session-1");
    expect(result.usage).toEqual({
      durationMs: 1234,
      inputTokens: 11,
      outputTokens: 22,
      costUsd: 0.04,
    });
    expect(result.harnessUsed).toEqual({
      kind: "claude-code",
      invocation: "headless",
      transport: "sdk",
    });
    expect(result.complianceEvidence?.notes?.join("\n")).toContain(
      "num_turns: 2",
    );
  });

  test("surfaces permission denials as evidence and warnings", async () => {
    const adapter = new ClaudeCodeSdkAdapter({
      executor: async () => ({
        exitCode: 0,
        stdout: streamJson([
          {
            type: "system",
            subtype: "init",
            session_id: "claude-session-1",
            model: "claude-sonnet-4-5",
          },
          {
            type: "result",
            is_error: false,
            result: "continued after denial",
            permission_denials: [
              {
                tool_name: "Bash",
                pattern: "sed -i",
                reason: "not allowed",
              },
            ],
          },
        ]),
        stderr: "",
        durationMs: 9,
      }),
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("ok");
    expect(result.warnings?.join("\n")).toContain("permission denial");
    expect(result.complianceEvidence?.notes?.join("\n")).toContain(
      "Bash: sed -i: not allowed",
    );
  });

  test("formats real SDK permission denial fields", async () => {
    const adapter = new ClaudeCodeSdkAdapter({
      executor: async () => ({
        exitCode: 0,
        stdout: streamJson([
          {
            type: "system",
            subtype: "init",
            session_id: "claude-session-1",
            model: "claude-sonnet-4-5",
          },
          {
            type: "result",
            is_error: false,
            result: "continued after denial",
            permission_denials: [
              {
                tool_name: "Bash",
                tool_use_id: "toolu_123",
                tool_input: {
                  command: "sed -i '' s/a/b/g file.txt",
                  description: "edit file",
                },
              },
            ],
          },
        ]),
        stderr: "",
        durationMs: 9,
      }),
    });

    const result = await adapter.runWorker(workerRequest());
    const notes = result.complianceEvidence?.notes?.join("\n");

    expect(result.status).toBe("ok");
    expect(notes).toContain("Bash: toolu_123");
    expect(notes).toContain("\"command\":\"sed -i '' s/a/b/g file.txt\"");
  });
});

function streamJson(records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}
