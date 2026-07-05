import { describe, expect, test } from "bun:test";
import {
  buildClaudeCodeArgs,
  buildOpenCodeArgs,
  ClaudeCodeHeadlessCliAdapter,
  OpenCodeHeadlessCliAdapter,
  type CommandExecution,
} from "../lib/protocol";
import { workerRequest } from "./fixtures";

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
