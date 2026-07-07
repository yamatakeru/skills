import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CursorSdkAdapter,
  buildCursorConfigContent,
  buildCursorSdkArgs,
  type CommandExecution,
} from "../lib/protocol";
import { workerRequest } from "./fixtures";

describe("Fusion Cursor SDK adapter", () => {
  test("spawns cursor-agent with config injection and parses stream evidence", async () => {
    const executions: CommandExecution[] = [];
    let configContent: unknown;
    const adapter = new CursorSdkAdapter({
      executor: async (execution) => {
        executions.push(execution);
        const configDir = execution.env?.CURSOR_CONFIG_DIR;
        expect(configDir).toBeDefined();
        configContent = JSON.parse(
          await readFile(join(String(configDir), "cli-config.json"), "utf8"),
        );
        return {
          exitCode: 0,
          stdout: streamJson([
            {
              type: "system",
              subtype: "init",
              cwd: "/workspace",
              session_id: "cursor-session-1",
              model: "Composer 2.5 Fast",
              permissionMode: "default",
            },
            {
              type: "user",
              message: {
                role: "user",
                content: [{ type: "text", text: "Reply exactly probe-ok." }],
              },
              session_id: "cursor-session-1",
            },
            {
              type: "assistant",
              message: {
                role: "assistant",
                content: [{ type: "text", text: "probe-ok" }],
              },
              session_id: "cursor-session-1",
            },
            {
              type: "result",
              subtype: "success",
              duration_ms: 5141,
              duration_api_ms: 5141,
              is_error: false,
              result: "probe-ok",
              session_id: "cursor-session-1",
              request_id: "request-1",
              usage: {
                inputTokens: 11245,
                outputTokens: 44,
                cacheReadTokens: 5920,
                cacheWriteTokens: 0,
              },
            },
          ]),
          stderr: "",
          durationMs: 99,
        };
      },
    });

    const result = await adapter.runWorker({
      ...workerRequest(),
      modelPreference: { model: "composer-2.5-fast" },
    });

    expect(executions[0]?.command).toBe("cursor-agent");
    expect(executions[0]?.args).toContain("--force");
    expect(executions[0]?.args).toContain("--model");
    expect(executions[0]?.args).toContain("composer-2.5-fast");
    expect(configContent).toEqual(buildCursorConfigContent("worker"));
    expect(result.status).toBe("ok");
    expect(result.output).toBe("probe-ok");
    expect(result.modelUsed).toBe("Composer 2.5 Fast");
    expect(result.sessionId).toBe("cursor-session-1");
    expect(result.usage).toEqual({
      durationMs: 5141,
      inputTokens: 11245,
      outputTokens: 44,
    });
    expect(result.harnessUsed).toEqual({
      kind: "cursor",
      invocation: "headless",
      transport: "sdk",
    });
    const notes = result.complianceEvidence?.notes?.join("\n");
    expect(notes).toContain("requested model id: composer-2.5-fast");
    expect(notes).toContain("observed model display name: Composer 2.5 Fast");
    expect(notes).toContain("request_id: request-1");
  });

  test("records success, rejected, permissionDenied, and writePermissionDenied tool results", async () => {
    const adapter = new CursorSdkAdapter({
      executor: async () => ({
        exitCode: 0,
        stdout: streamJson([
          {
            type: "system",
            subtype: "init",
            session_id: "cursor-session-2",
            model: "Composer 2.5 Fast",
            permissionMode: "default",
          },
          {
            type: "tool_call",
            subtype: "completed",
            call_id: "tool-read",
            tool_call: {
              readToolCall: {
                result: {
                  success: {
                    path: "/workspace/README.md",
                    content: "probe workspace\n",
                  },
                },
              },
            },
          },
          {
            type: "tool_call",
            subtype: "completed",
            call_id: "tool-search",
            tool_call: {
              webSearchToolCall: {
                result: { rejected: { reason: "User Rejected" } },
              },
            },
          },
          {
            type: "tool_call",
            subtype: "completed",
            call_id: "tool-shell",
            tool_call: {
              shellToolCall: {
                result: {
                  permissionDenied: {
                    command: "ls",
                    error: "Command blocked by permissions configuration",
                  },
                },
              },
            },
          },
          {
            type: "tool_call",
            subtype: "completed",
            call_id: "tool-write",
            tool_call: {
              editToolCall: {
                result: {
                  writePermissionDenied: {
                    path: "",
                    error: "Write permission denied: /workspace/out.txt",
                  },
                },
              },
            },
          },
          {
            type: "result",
            is_error: false,
            result: "continued after denials",
            session_id: "cursor-session-2",
          },
        ]),
        stderr: "",
        durationMs: 17,
      }),
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("ok");
    expect(result.toolUseSummary?.toolsUsed).toEqual([
      "Read",
      "WebSearch",
      "Shell",
      "Write",
    ]);
    expect(result.toolUseSummary?.deniedRequests?.join("\n")).toContain(
      "User Rejected",
    );
    expect(result.toolUseSummary?.deniedRequests?.join("\n")).toContain(
      "Command blocked by permissions configuration",
    );
    expect(result.toolUseSummary?.deniedRequests?.join("\n")).toContain(
      "Write permission denied",
    );
    expect(result.warnings?.join("\n")).toContain("denied tool result");
    expect(result.complianceEvidence?.notes?.join("\n")).toContain(
      "Cursor tool Shell ended with status permissionDenied",
    );
  });

  test("records error tool results (live-verified Read(**) denial shape)", async () => {
    const adapter = new CursorSdkAdapter({
      executor: async () => ({
        exitCode: 0,
        stdout: streamJson([
          {
            type: "system",
            subtype: "init",
            session_id: "cursor-session-5",
            model: "Composer 2.5 Fast",
            permissionMode: "default",
          },
          {
            type: "tool_call",
            subtype: "completed",
            call_id: "tool-read-denied",
            tool_call: {
              readToolCall: {
                result: { error: { errorMessage: "Permission denied" } },
              },
            },
          },
          {
            type: "result",
            is_error: false,
            result: "disclosed the read denial",
            session_id: "cursor-session-5",
          },
        ]),
        stderr: "",
        durationMs: 11,
      }),
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("ok");
    expect(result.toolUseSummary?.toolsUsed).toEqual(["Read"]);
    expect(result.toolUseSummary?.deniedRequests).toBeUndefined();
    expect(result.complianceEvidence?.notes?.join("\n")).toContain(
      "Cursor tool Read ended with status error: Permission denied",
    );
  });

  test("cleans up the injected CURSOR_CONFIG_DIR when the executor throws", async () => {
    let capturedDir: string | undefined;
    const adapter = new CursorSdkAdapter({
      executor: async (execution) => {
        capturedDir = execution.env?.CURSOR_CONFIG_DIR;
        await readFile(join(String(capturedDir), "cli-config.json"), "utf8");
        throw new Error("spawn ENOENT");
      },
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("error");
    expect(result.errors?.join("\n")).toContain("spawn ENOENT");
    expect(capturedDir).toBeDefined();
    await expect(
      readFile(join(String(capturedDir), "cli-config.json"), "utf8"),
    ).rejects.toThrow();
  });

  test("treats non-JSON ActionRequiredError output as a disclosed worker failure", async () => {
    const adapter = new CursorSdkAdapter({
      executor: async () => ({
        exitCode: 1,
        stdout: "ActionRequiredError: You've reached your usage limit\n",
        stderr: "",
        durationMs: 3,
      }),
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("error");
    expect(result.errors?.join("\n")).toContain("ActionRequiredError");
    expect(result.warnings?.join("\n")).toContain("non-JSON line");
    expect(result.complianceEvidence?.notes?.join("\n")).toContain(
      "Cursor non-JSON stream line: ActionRequiredError",
    );
  });

  test("tolerates undocumented and future event types", async () => {
    const adapter = new CursorSdkAdapter({
      executor: async () => ({
        exitCode: 0,
        stdout: streamJson([
          {
            type: "system",
            subtype: "init",
            session_id: "cursor-session-3",
            model: "Composer 2.5 Fast",
          },
          { type: "thinking", subtype: "delta", text: "I will answer" },
          { type: "connection", subtype: "restored" },
          { type: "retry", message: "retrying provider call" },
          { type: "future_event", payload: true },
          { type: "result", is_error: false, result: "ok" },
        ]),
        stderr: "",
        durationMs: 5,
      }),
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("ok");
    expect(result.output).toBe("ok");
    expect(result.warnings?.join("\n")).toContain("future_event");
    expect(result.warnings?.join("\n")).not.toContain("thinking");
  });

  test("builds judge profile config with Read deny and no --force", async () => {
    let execution: CommandExecution | undefined;
    let configContent: unknown;
    const judgeRequest = {
      ...workerRequest(),
      workerId: "judge",
      toolsPolicy: {
        mode: "none" as const,
        allow: [],
        deny: [],
        headlessAskBehavior: "deny" as const,
        parity: "strict-same-required" as const,
      },
    };
    const adapter = new CursorSdkAdapter({
      executor: async (candidate) => {
        execution = candidate;
        const configDir = candidate.env?.CURSOR_CONFIG_DIR;
        expect(configDir).toBeDefined();
        configContent = JSON.parse(
          await readFile(join(String(configDir), "cli-config.json"), "utf8"),
        );
        return {
          exitCode: 0,
          stdout: streamJson([
            {
              type: "system",
              subtype: "init",
              session_id: "cursor-judge-session",
              model: "Composer 2.5 Fast",
            },
            { type: "result", is_error: false, result: "{}" },
          ]),
          stderr: "",
          durationMs: 11,
        };
      },
    });

    const result = await adapter.runWorker(judgeRequest);
    const args = buildCursorSdkArgs(judgeRequest);

    expect(result.status).toBe("ok");
    expect(args).not.toContain("--force");
    expect(execution?.args).not.toContain("--force");
    expect(configContent).toEqual(buildCursorConfigContent("judge"));
    expect(
      (configContent as { permissions: { deny: string[] } }).permissions.deny,
    ).toContain("Read(**)");
    expect(result.complianceEvidence?.notes?.join("\n")).toContain(
      "judge profile used --trust without --force",
    );
  });
});

function streamJson(records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}
