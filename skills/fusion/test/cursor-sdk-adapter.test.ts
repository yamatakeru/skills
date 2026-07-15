import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CursorSdkAdapter,
  buildCursorConfigContent,
  buildCursorSdkArgs,
  cursorHookScriptContent,
  type CommandExecution,
} from "../lib/protocol";
import { withFusionPanelDepth, workerRequest } from "./fixtures";

describe("Fusion Cursor SDK adapter", () => {
  for (const [label, parentDepth, expectedDepth] of [
    ["defaults an absent panel depth to 0", undefined, "1"],
    ["increments an inherited panel depth", "1", "2"],
  ] as const) {
    test(`${label} for spawned workers`, async () => {
      await withFusionPanelDepth(parentDepth, async () => {
        let execution: CommandExecution | undefined;
        const adapter = new CursorSdkAdapter({
          executor: async (input) => {
            execution = input;
            return {
              exitCode: 0,
              stdout: streamJson([
                { type: "result", is_error: false, result: "ok" },
              ]),
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

  test("spawns cursor-agent with config injection and parses stream evidence", async () => {
    const executions: CommandExecution[] = [];
    const request = {
      ...workerRequest(),
      modelPreference: { model: "composer-2.5-fast" },
      environment: { workspaceRoot: "/workspace", readRoots: ["/external"] },
    };
    let scratchDir: string | undefined;
    let configDir: string | undefined;
    let hookScriptPath: string | undefined;
    let configContent: unknown;
    let hooksContent: {
      hooks: Record<string, Array<{ command: string; failClosed?: boolean }>>;
    };
    const adapter = new CursorSdkAdapter({
      executor: async (execution) => {
        executions.push(execution);
        scratchDir = execution.cwd;
        configDir = execution.env?.CURSOR_CONFIG_DIR;
        expect(configDir).toBeDefined();
        configContent = JSON.parse(
          await readFile(join(String(configDir), "cli-config.json"), "utf8"),
        );
        expect(scratchDir).toBeDefined();
        hooksContent = JSON.parse(
          await readFile(
            join(String(scratchDir), ".cursor", "hooks.json"),
            "utf8",
          ),
        );
        expect(Object.keys(hooksContent.hooks).sort()).toEqual([
          "beforeReadFile",
          "beforeShellExecution",
          "preToolUse",
        ]);
        for (const entries of Object.values(hooksContent.hooks)) {
          expect(entries).toHaveLength(1);
          expect(entries[0]?.failClosed).toBe(true);
          expect(entries[0]?.command.startsWith("bun ")).toBe(true);
        }
        hookScriptPath = hooksContent.hooks.beforeShellExecution?.[0]?.command
          .replace(/^bun /u, "")
          .replace(/^'|'$/gu, "");
        expect(hookScriptPath).toBeDefined();
        const hookScript = await readFile(String(hookScriptPath), "utf8");
        expect(hookScript).toContain("Fusion panel tools policy");
        expect(hookScript).not.toContain("/workspace");
        expect(JSON.parse(String(execution.env?.FUSION_CURSOR_READ_ROOTS))).toEqual([
          String(scratchDir),
          "/workspace",
          "/external",
        ]);
        expect(
          JSON.parse(String(execution.env?.FUSION_CURSOR_SHELL_ALLOWLIST)),
        ).toEqual(request.toolsPolicy?.readOnlyBashCommands);
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

    const result = await adapter.runWorker(request);

    expect(executions[0]?.command).toBe("cursor-agent");
    expect(executions[0]?.cwd).toBe(scratchDir);
    expect(executions[0]?.args).toContain("--force");
    expect(executions[0]?.args).toContain("--model");
    expect(executions[0]?.args).toContain("composer-2.5-fast");
    expect(executions[0]?.args).toContain("--add-dir");
    expect(executions[0]?.args).toContain("/workspace");
    expect(executions[0]?.args).toContain("/external");
    expect(configContent).toEqual(buildCursorConfigContent("worker"));
    expect(
      (configContent as { permissions: { deny: string[] } }).permissions.deny,
    ).not.toContain("Shell(**)");
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
    expect(result.complianceEvidence?.adapterClaimsIsolatedContext).toBe(true);
    expect(result.complianceEvidence?.enforcement?.source).toBe(
      "harness-declared",
    );
    expect(result.complianceEvidence?.containment).toBe("allowlist-enforced");
    const notes = result.complianceEvidence?.notes?.join("\n");
    expect(notes).toContain("requested model id: composer-2.5-fast");
    expect(notes).toContain("observed model display name: Composer 2.5 Fast");
    expect(notes).toContain("request_id: request-1");
    expect(notes).toContain("Cursor hooks materialized");
    expect(notes).toContain("beforeShellExecution, preToolUse, beforeReadFile");
    expect(notes).toContain("failClosed enabled");
    expect(notes).toContain("request.toolsPolicy.readOnlyBashCommands");
    expect(notes).toContain("Cursor read roots enforced by beforeReadFile hook");
    expect(notes).toContain("account-level User Rules inject");
    expect(notes).toContain("headless project hook loading");
    expect(notes).not.toContain("compliance is degraded");
    await expect(
      readFile(join(String(scratchDir), ".cursor", "hooks.json"), "utf8"),
    ).rejects.toThrow();
    await expect(readFile(String(hookScriptPath), "utf8")).rejects.toThrow();
    await expect(
      readFile(join(String(configDir), "cli-config.json"), "utf8"),
    ).rejects.toThrow();
  });

  test("does not claim isolated context when a fresh run has no session id", async () => {
    const adapter = new CursorSdkAdapter({
      executor: async () => ({
        exitCode: 0,
        stdout: streamJson([
          {
            type: "system",
            subtype: "init",
            model: "Composer 2.5 Fast",
            permissionMode: "default",
          },
          { type: "result", is_error: false, result: "ok" },
        ]),
        stderr: "",
        durationMs: 5,
      }),
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("ok");
    expect(result.sessionId).toBeUndefined();
    expect(result.complianceEvidence?.adapterClaimsIsolatedContext).toBe(false);
    expect(
      result.complianceEvidence?.adapterClaimsIndependentInvocation,
    ).toBe(false);
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
    expect(
      result.complianceEvidence?.enforcement?.permissionDenialCount,
    ).toBe(3);
    expect(result.complianceEvidence?.notes?.join("\n")).toContain(
      "Cursor tool Shell ended with status permissionDenied",
    );
  });

  test("uses hooks as the worker shell authority while judge keeps shell denied", () => {
    expect(buildCursorConfigContent("worker").permissions.deny).toEqual([
      "Write(**)",
      "Delete(**)",
      "Mcp(*)",
    ]);
    expect(buildCursorConfigContent("worker").permissions.deny).not.toContain(
      "Shell(**)",
    );
    expect(buildCursorConfigContent("judge").permissions.deny).toEqual([
      "Shell(**)",
      "Write(**)",
      "Delete(**)",
      "Mcp(*)",
      "Read(**)",
    ]);
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

  test("counts hook-blocked error tool results as denials", async () => {
    const adapter = new CursorSdkAdapter({
      executor: async () => ({
        exitCode: 0,
        stdout: streamJson([
          {
            type: "system",
            subtype: "init",
            session_id: "cursor-session-hook-denial",
            model: "Composer 2.5 Fast",
            permissionMode: "default",
          },
          {
            type: "tool_call",
            subtype: "completed",
            call_id: "tool-task-denied",
            tool_call: {
              taskToolCall: {
                result: {
                  error: {
                    errorMessage:
                      "Task blocked by preToolUse hook: recursive delegation denied",
                  },
                },
              },
            },
          },
          {
            type: "result",
            is_error: false,
            result: "disclosed the Task denial",
            session_id: "cursor-session-hook-denial",
          },
        ]),
        stderr: "",
        durationMs: 11,
      }),
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("ok");
    expect(result.toolUseSummary?.toolsUsed).toEqual(["Task"]);
    expect(result.toolUseSummary?.deniedRequests?.join("\n")).toContain(
      "Task blocked by preToolUse hook",
    );
    expect(result.warnings?.join("\n")).toContain("denied tool result");
  });

  test("cleans up injected config and scratch dirs when the executor throws", async () => {
    let capturedDir: string | undefined;
    let capturedScratchDir: string | undefined;
    const adapter = new CursorSdkAdapter({
      executor: async (execution) => {
        capturedDir = execution.env?.CURSOR_CONFIG_DIR;
        capturedScratchDir = execution.cwd;
        await readFile(join(String(capturedDir), "cli-config.json"), "utf8");
        await readFile(
          join(String(capturedScratchDir), ".cursor", "hooks.json"),
          "utf8",
        );
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
    expect(capturedScratchDir).toBeDefined();
    await expect(
      readFile(join(String(capturedScratchDir), ".cursor", "hooks.json"), "utf8"),
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

  test("hook script gates shell with word-boundary allowlist, denies Task, and enforces read roots", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "fusion-hook-script-test-"));
    const scriptPath = join(scratch, "fusion-cursor-hook.js");
    await writeFile(scriptPath, cursorHookScriptContent(), "utf8");
    const env = {
      ...process.env,
      FUSION_CURSOR_SHELL_ALLOWLIST: JSON.stringify([
        "git status",
        "ls",
        "cat",
        "rg",
        "git log",
      ]),
      FUSION_CURSOR_READ_ROOTS: JSON.stringify([scratch]),
    };
    const runHook = (payload: unknown): { permission?: string } => {
      const proc = Bun.spawnSync(["bun", scriptPath], {
        env,
        stdin: Buffer.from(JSON.stringify(payload)),
      });
      return JSON.parse(proc.stdout.toString());
    };
    try {
      const shell = (command: string) =>
        runHook({ hook_event_name: "beforeShellExecution", command });
      expect(shell("ls").permission).toBe("allow");
      expect(shell("ls -la").permission).toBe("allow");
      expect(shell("git status --short").permission).toBe("allow");
      expect(shell("lsof").permission).toBe("deny");
      expect(shell("catastrophe.sh").permission).toBe("deny");
      expect(shell("rm -rf /").permission).toBe("deny");
      for (const command of [
        "ls && rm -rf /",
        "git status; rm -rf /",
        "git status || rm -rf /",
        "rg pattern | sh",
        "ls > /tmp/evil",
        "ls >> /tmp/evil",
        "cat < /etc/shadow",
        "ls $(rm -rf /)",
        "ls `rm -rf /`",
        "cat <(echo x)",
        "ls & rm -rf /",
        "ls" + "\n" + "rm -rf /",
        "FOO=bar ls",
      ]) {
        expect(shell(command).permission).toBe("deny");
      }
      for (const command of [
        'rg "a && b"',
        "rg 'a && b'",
        'git log --grep="x|y"',
        "rg foo$ file.txt",
      ]) {
        expect(shell(command).permission).toBe("allow");
      }

      expect(
        runHook({ hook_event_name: "preToolUse", tool_name: "Task" }).permission,
      ).toBe("deny");
      expect(
        runHook({ hook_event_name: "preToolUse", tool_name: "Read" }).permission,
      ).toBe("allow");

      const read = (filePath: string) =>
        runHook({ hook_event_name: "beforeReadFile", file_path: filePath });
      expect(read(join(scratch, "inside.txt")).permission).toBe("allow");
      expect(read("/etc/passwd").permission).toBe("deny");
      expect(read(`${scratch}-sibling/escape.txt`).permission).toBe("deny");
      expect(read("relative/path.txt").permission).toBe("deny");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

function streamJson(records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}
