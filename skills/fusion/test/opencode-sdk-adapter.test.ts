import { describe, expect, test } from "bun:test";
import {
  OpenCodeSdkAdapter,
  buildOpenCodeConfigContent,
  buildOpenCodePermissionMap,
  type OpenCodeServerFactory,
  type OpenCodeServerFactoryInput,
} from "../lib/protocol";
import { withFusionPanelDepth, workerRequest } from "./fixtures";

const encoder = new TextEncoder();

describe("Fusion OpenCode SDK adapter", () => {
  for (const [label, parentDepth, expectedDepth] of [
    ["defaults an absent panel depth to 0", undefined, "1"],
    ["increments an inherited panel depth", "1", "2"],
  ] as const) {
    test(`${label} for the spawned serve process`, async () => {
      await withFusionPanelDepth(parentDepth, async () => {
        let factoryInput: OpenCodeServerFactoryInput | undefined;
        const adapter = new OpenCodeSdkAdapter({
          serverFactory: async (input) => {
            factoryInput = input;
            throw new Error("stop after environment capture");
          },
          versionExecutor,
        });

        await adapter.runWorker(workerRequest());

        expect(factoryInput?.env.FUSION_PANEL_DEPTH).toBe(expectedDepth);
      });
    });
  }

  test("maps SDK response evidence to a worker result", async () => {
    let promptMessageId: string | undefined;
    const adapter = new OpenCodeSdkAdapter({
      baseUrl: "http://opencode.test",
      versionExecutor: async () => ({
        exitCode: 0,
        stdout: "1.17.13\n",
        stderr: "",
        durationMs: 1,
      }),
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/session" && init?.method === "POST") {
          return Response.json({ id: "session-1" });
        }
        if (url.pathname === "/event") {
          return sseResponse(async () => {
            const messageId = await waitForValue(() => promptMessageId);
            return [
              sse({
                type: "message.part.updated",
                properties: {
                  part: {
                    id: "prompt-echo-1",
                    sessionID: "session-1",
                    messageID: messageId,
                    type: "text",
                    text: "echoed prompt text",
                  },
                },
              }),
              sse({
                type: "message.part.updated",
                properties: {
                  part: {
                    id: "part-1",
                    sessionID: "session-1",
                    messageID: assistantMessageId(messageId),
                    type: "text",
                    text: "SDK answer",
                  },
                },
              }),
              sse({
                type: "message.part.updated",
                properties: {
                  part: {
                    id: "tool-1",
                    sessionID: "session-1",
                    messageID: assistantMessageId(messageId),
                    type: "tool",
                    tool: "grep",
                    state: { status: "completed", input: {}, output: "" },
                  },
                },
              }),
              sse({
                type: "message.updated",
                properties: {
                  info: assistantMessage(assistantMessageId(messageId)),
                },
              }),
            ].join("");
          });
        }
        if (url.pathname === "/session/session-1/prompt_async") {
          promptMessageId = JSON.parse(String(init?.body)).messageID;
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      },
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("ok");
    expect(result.output).toBe("SDK answer");
    expect(result.modelUsed).toBe("openai/gpt-5.5");
    expect(result.sessionId).toBe("session-1");
    expect(result.harnessUsed).toEqual({
      kind: "opencode",
      invocation: "headless",
      transport: "sdk",
      version: "1.17.13",
    });
    expect(result.usage?.inputTokens).toBe(10);
    expect(result.usage?.outputTokens).toBe(20);
    expect(result.usage?.costUsd).toBe(0.03);
    expect(result.toolUseSummary?.toolsUsed).toEqual(["grep"]);
    expect(result.warnings?.join("\n") ?? "").not.toContain("degraded");
  });

  test("waits for the SSE stream before sending the prompt", async () => {
    let eventResponse:
      | ((response: Response) => void)
      | undefined;
    let eventRequested = false;
    let sseReady = false;
    let promptSent = false;
    let promptBeforeSseReady = false;
    let streamController:
      | ReadableStreamDefaultController<Uint8Array>
      | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    const adapter = new OpenCodeSdkAdapter({
      baseUrl: "http://opencode.test",
      versionExecutor: versionExecutor,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/session" && init?.method === "POST") {
          return Response.json({ id: "session-1" });
        }
        if (url.pathname === "/event") {
          eventRequested = true;
          return new Promise<Response>((resolve) => {
            eventResponse = resolve;
          });
        }
        if (url.pathname === "/session/session-1/prompt_async") {
          promptSent = true;
          promptBeforeSseReady = !sseReady;
          const messageId = JSON.parse(String(init?.body)).messageID;
          streamController?.enqueue(
            encoder.encode(
              [
                sse({
                  type: "message.part.updated",
                  properties: {
                    part: {
                      id: "part-1",
                      sessionID: "session-1",
                      messageID: assistantMessageId(messageId),
                      type: "text",
                      text: "Race-free answer",
                    },
                  },
                }),
                sse({
                  type: "message.updated",
                  properties: {
                    info: assistantMessage(assistantMessageId(messageId)),
                  },
                }),
              ].join(""),
            ),
          );
          streamController?.close();
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      },
    });

    const resultPromise = adapter.runWorker(workerRequest());
    await waitForValue(() =>
      eventRequested && eventResponse !== undefined ? true : undefined,
    );
    await Bun.sleep(5);
    expect(promptSent).toBe(false);

    sseReady = true;
    eventResponse?.(
      new Response(stream, { headers: { "Content-Type": "text/event-stream" } }),
    );
    const result = await resultPromise;

    expect(promptBeforeSseReady).toBe(false);
    expect(result.status).toBe("ok");
    expect(result.output).toBe("Race-free answer");
  });

  test("auto-rejects unexpected permission events and records a warning", async () => {
    let promptMessageId: string | undefined;
    const permissionReplies: unknown[] = [];
    const adapter = new OpenCodeSdkAdapter({
      baseUrl: "http://opencode.test",
      versionExecutor: versionExecutor,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/session" && init?.method === "POST") {
          return Response.json({ id: "session-1" });
        }
        if (url.pathname === "/event") {
          return sseResponse(async () => {
            const messageId = await waitForValue(() => promptMessageId);
            return [
              sse({
                type: "permission.updated",
                properties: {
                  id: "permission-1",
                  sessionID: "session-1",
                  messageID: assistantMessageId(messageId),
                  type: "external_directory",
                  title: "Read /private/path",
                  metadata: {},
                  time: { created: Date.now() },
                },
              }),
              sse({
                type: "message.part.updated",
                properties: {
                  part: {
                    id: "part-1",
                    sessionID: "session-1",
                    messageID: assistantMessageId(messageId),
                    type: "text",
                    text: "Denied but continued",
                  },
                },
              }),
              sse({
                type: "message.updated",
                properties: {
                  info: assistantMessage(assistantMessageId(messageId)),
                },
              }),
            ].join("");
          });
        }
        if (url.pathname === "/session/session-1/prompt_async") {
          promptMessageId = JSON.parse(String(init?.body)).messageID;
          return new Response(null, { status: 204 });
        }
        if (url.pathname === "/session/session-1/permissions/permission-1") {
          permissionReplies.push(JSON.parse(String(init?.body)));
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      },
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("ok");
    expect(permissionReplies).toEqual([{ response: "reject" }]);
    expect(result.warnings?.join("\n")).toContain("unexpected permission ask");
    expect(result.toolUseSummary?.deniedRequests).toEqual([
      "Read /private/path",
    ]);
  });

  test("builds permission config from tools policy and read roots", () => {
    const config = buildOpenCodeConfigContent({
      toolsPolicy: {
        mode: "read-only",
        allow: ["Read", "Grep", "Glob", "WebFetch", "WebSearch", "Bash"],
        deny: ["Write", "Edit", "Task"],
        readOnlyBashCommands: ["git status", "rg"],
      },
      environment: { readRoots: ["/tmp/context"] },
    });
    const agent = config.agent["fusion-worker"];
    const bash = agent.permission.bash as Record<string, string>;
    const externalDirectory = agent.permission.external_directory as Record<
      string,
      string
    >;

    expect(Object.keys(agent.permission)[0]).toBe("*");
    expect(agent.permission["*"]).toBe("deny");
    expect(agent.permission.read).toBe("allow");
    expect(agent.permission.grep).toBe("allow");
    expect(agent.permission.glob).toBe("allow");
    expect(agent.permission.list).toBe("allow");
    expect(agent.tools.read).toBe(true);
    expect(agent.tools.grep).toBe(true);
    expect(agent.tools.write).toBe(false);
    expect(agent.permission.edit).toBe("deny");
    expect(bash["*"]).toBe("deny");
    expect(bash["git status *"]).toBe("allow");
    expect(bash["rg *"]).toBe("allow");
    expect(externalDirectory["*"]).toBe("deny");
    expect(externalDirectory["/tmp/context/**"]).toBe("allow");
    expect(config.experimental.continue_loop_on_deny).toBe(true);
  });

  test("keeps bash permission semantics behind the top-level catch-all", () => {
    const readOnly = buildOpenCodePermissionMap(
      {
        mode: "read-only",
        readOnlyBashCommands: ["git status", "rg"],
      },
      undefined,
    );
    const none = buildOpenCodePermissionMap({ mode: "none" }, undefined);
    const full = buildOpenCodePermissionMap({ mode: "full" }, undefined);

    expect(Object.keys(readOnly)[0]).toBe("*");
    expect(readOnly.bash).toEqual({
      "*": "deny",
      "git status": "allow",
      "git status *": "allow",
      rg: "allow",
      "rg *": "allow",
    });
    expect(none.bash).toEqual({ "*": "deny" });
    expect(none.webfetch).toBe("deny");
    expect(none.websearch).toBe("deny");
    expect(full.bash).toEqual({ "*": "allow" });
  });

  test("warns when a model preference cannot be split for OpenCode", async () => {
    let promptMessageId: string | undefined;
    let promptBody: Record<string, unknown> | undefined;
    const adapter = new OpenCodeSdkAdapter({
      baseUrl: "http://opencode.test",
      versionExecutor: versionExecutor,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/session" && init?.method === "POST") {
          return Response.json({ id: "session-1" });
        }
        if (url.pathname === "/event") {
          return sseResponse(async () => {
            const messageId = await waitForValue(() => promptMessageId);
            return [
              sse({
                type: "message.part.updated",
                properties: {
                  part: {
                    id: "part-1",
                    sessionID: "session-1",
                    messageID: assistantMessageId(messageId),
                    type: "text",
                    text: "Default model answer",
                  },
                },
              }),
              sse({
                type: "message.updated",
                properties: {
                  info: assistantMessage(assistantMessageId(messageId)),
                },
              }),
            ].join("");
          });
        }
        if (url.pathname === "/session/session-1/prompt_async") {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          promptBody = body;
          promptMessageId = String(body.messageID);
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      },
    });

    const result = await adapter.runWorker({
      ...workerRequest(),
      modelPreference: { model: "gpt-5.5" },
    });

    expect(result.status).toBe("ok");
    expect(promptBody).not.toHaveProperty("tools");
    expect(promptBody?.model).toBeUndefined();
    expect(result.warnings?.join("\n")).toContain("gpt-5.5");
    expect(result.warnings?.join("\n")).toContain("provider/model");
  });

  test("tolerates malformed SSE events before a valid completion", async () => {
    let promptMessageId: string | undefined;
    const adapter = new OpenCodeSdkAdapter({
      baseUrl: "http://opencode.test",
      versionExecutor: versionExecutor,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/session" && init?.method === "POST") {
          return Response.json({ id: "session-1" });
        }
        if (url.pathname === "/event") {
          return sseResponse(async () => {
            const messageId = await waitForValue(() => promptMessageId);
            return [
              "data: not json\n\n",
              sse({
                type: "message.part.updated",
                properties: {
                  part: {
                    id: "part-1",
                    sessionID: "session-1",
                    messageID: assistantMessageId(messageId),
                    type: "text",
                    text: "Recovered",
                  },
                },
              }),
              sse({
                type: "message.updated",
                properties: {
                  info: assistantMessage(assistantMessageId(messageId)),
                },
              }),
            ].join("");
          });
        }
        if (url.pathname === "/session/session-1/prompt_async") {
          promptMessageId = JSON.parse(String(init?.body)).messageID;
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      },
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("ok");
    expect(result.output).toBe("Recovered");
    expect(result.warnings?.join("\n")).toContain("SSE event");
  });

  test("tolerates assistant message updates without time metadata", async () => {
    let promptMessageId: string | undefined;
    const adapter = new OpenCodeSdkAdapter({
      baseUrl: "http://opencode.test",
      versionExecutor: versionExecutor,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/session" && init?.method === "POST") {
          return Response.json({ id: "session-1" });
        }
        if (url.pathname === "/event") {
          return sseResponse(async () => {
            const messageId = await waitForValue(() => promptMessageId);
            const { time: _time, ...partialInfo } = assistantMessage(assistantMessageId(messageId));
            return [
              sse({
                type: "message.part.updated",
                properties: {
                  part: {
                    id: "part-1",
                    sessionID: "session-1",
                    messageID: assistantMessageId(messageId),
                    type: "text",
                    text: "Partial update answer",
                  },
                },
              }),
              sse({
                type: "message.updated",
                properties: {
                  info: partialInfo,
                },
              }),
              sse({
                type: "message.updated",
                properties: {
                  info: assistantMessage(assistantMessageId(messageId)),
                },
              }),
            ].join("");
          });
        }
        if (url.pathname === "/session/session-1/prompt_async") {
          promptMessageId = JSON.parse(String(init?.body)).messageID;
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      },
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("ok");
    expect(result.output).toBe("Partial update answer");
  });

  test("keeps collecting past step boundaries that finish with tool-calls", async () => {
    let promptMessageId: string | undefined;
    const adapter = new OpenCodeSdkAdapter({
      baseUrl: "http://opencode.test",
      versionExecutor: versionExecutor,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/session" && init?.method === "POST") {
          return Response.json({ id: "session-1" });
        }
        if (url.pathname === "/event") {
          return sseResponse(async () => {
            const messageId = await waitForValue(() => promptMessageId);
            const stepMessageId = `${assistantMessageId(messageId)}-step`;
            return [
              sse({
                type: "message.part.updated",
                properties: {
                  part: {
                    id: "part-intro",
                    sessionID: "session-1",
                    messageID: stepMessageId,
                    type: "text",
                    text: "Intro before tools",
                  },
                },
              }),
              sse({
                type: "message.updated",
                properties: {
                  info: {
                    ...assistantMessage(stepMessageId),
                    finish: "tool-calls",
                  },
                },
              }),
              sse({
                type: "message.part.updated",
                properties: {
                  part: {
                    id: "part-final",
                    sessionID: "session-1",
                    messageID: assistantMessageId(messageId),
                    type: "text",
                    text: "Final assessment",
                  },
                },
              }),
              sse({
                type: "message.updated",
                properties: {
                  info: assistantMessage(assistantMessageId(messageId)),
                },
              }),
            ].join("");
          });
        }
        if (url.pathname === "/session/session-1/prompt_async") {
          promptMessageId = JSON.parse(String(init?.body)).messageID;
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      },
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("ok");
    expect(result.output).toBe("Intro before tools\nFinal assessment");
  });

  test("treats session.idle as a terminal marker when finish never reaches stop", async () => {
    let promptMessageId: string | undefined;
    const adapter = new OpenCodeSdkAdapter({
      baseUrl: "http://opencode.test",
      versionExecutor: versionExecutor,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/session" && init?.method === "POST") {
          return Response.json({ id: "session-1" });
        }
        if (url.pathname === "/event") {
          return sseResponse(async () => {
            const messageId = await waitForValue(() => promptMessageId);
            const { finish: _finish, ...noFinishInfo } = assistantMessage(
              assistantMessageId(messageId),
            );
            return [
              sse({
                type: "message.part.updated",
                properties: {
                  part: {
                    id: "part-1",
                    sessionID: "session-1",
                    messageID: assistantMessageId(messageId),
                    type: "text",
                    text: "Idle-terminated answer",
                  },
                },
              }),
              sse({
                type: "message.updated",
                properties: {
                  info: noFinishInfo,
                },
              }),
              sse({
                type: "session.idle",
                properties: {
                  sessionID: "session-1",
                },
              }),
            ].join("");
          });
        }
        if (url.pathname === "/session/session-1/prompt_async") {
          promptMessageId = JSON.parse(String(init?.body)).messageID;
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      },
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("ok");
    expect(result.output).toBe("Idle-terminated answer");
  });

  test("aborts a completed session before disconnecting SSE", async () => {
    let promptMessageId: string | undefined;
    const terminalOrder: string[] = [];
    const adapter = new OpenCodeSdkAdapter({
      baseUrl: "http://opencode.test",
      versionExecutor,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/session" && init?.method === "POST") {
          return Response.json({ id: "session-1" });
        }
        if (url.pathname === "/event") {
          init?.signal?.addEventListener("abort", () => {
            terminalOrder.push("disconnect");
          });
          return sseResponse(async () => {
            const messageId = await waitForValue(() => promptMessageId);
            return completedAnswerSse(messageId, "Collected answer");
          });
        }
        if (url.pathname === "/session/session-1/prompt_async") {
          promptMessageId = JSON.parse(String(init?.body)).messageID;
          return new Response(null, { status: 204 });
        }
        if (url.pathname === "/session/session-1/abort") {
          terminalOrder.push("abort");
          return Response.json(true);
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      },
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("ok");
    expect(result.output).toBe("Collected answer");
    expect(terminalOrder).toEqual(["abort", "disconnect"]);
  });

  test("aborts the session when prompt submission fails", async () => {
    let abortCalls = 0;
    const adapter = new OpenCodeSdkAdapter({
      baseUrl: "http://opencode.test",
      versionExecutor,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/session" && init?.method === "POST") {
          return Response.json({ id: "session-1" });
        }
        if (url.pathname === "/event") {
          return openSseResponse();
        }
        if (url.pathname === "/session/session-1/prompt_async") {
          return new Response("boom", { status: 500 });
        }
        if (url.pathname === "/session/session-1/abort") {
          abortCalls += 1;
          return Response.json(true);
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      },
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("error");
    expect(abortCalls).toBe(1);
  });

  test("aborts the session on timeout", async () => {
    let abortCalls = 0;
    const adapter = new OpenCodeSdkAdapter({
      baseUrl: "http://opencode.test",
      versionExecutor,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/session" && init?.method === "POST") {
          return Response.json({ id: "session-1" });
        }
        if (url.pathname === "/event") {
          return openSseResponse();
        }
        if (url.pathname === "/session/session-1/prompt_async") {
          return new Response(null, { status: 204 });
        }
        if (url.pathname === "/session/session-1/abort") {
          abortCalls += 1;
          return Response.json(true);
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      },
    });

    const result = await adapter.runWorker({
      ...workerRequest(),
      budget: { timeoutMs: 25 },
    });

    expect(result.status).toBe("timeout");
    expect(abortCalls).toBe(1);
  });

  test("records an abort warning without failing a completed worker", async () => {
    let promptMessageId: string | undefined;
    const adapter = new OpenCodeSdkAdapter({
      baseUrl: "http://opencode.test",
      versionExecutor,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/session" && init?.method === "POST") {
          return Response.json({ id: "session-1" });
        }
        if (url.pathname === "/event") {
          return sseResponse(async () => {
            const messageId = await waitForValue(() => promptMessageId);
            return completedAnswerSse(messageId, "Still successful");
          });
        }
        if (url.pathname === "/session/session-1/prompt_async") {
          promptMessageId = JSON.parse(String(init?.body)).messageID;
          return new Response(null, { status: 204 });
        }
        if (url.pathname === "/session/session-1/abort") {
          return new Response("abort unavailable", { status: 500 });
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      },
    });

    const result = await adapter.runWorker(workerRequest());

    expect(result.status).toBe("ok");
    expect(result.output).toBe("Still successful");
    expect(result.warnings?.join("\n")).toContain(
      "session may linger until server shutdown",
    );
    expect(result.complianceEvidence?.notes?.join("\n")).toContain(
      "session may linger until server shutdown",
    );
  });

  test("fails every worker before session creation when effective rules mismatch", async () => {
    let serverStarts = 0;
    let agentRequests = 0;
    let sessionRequests = 0;
    const serverFactory: OpenCodeServerFactory = async () => {
      serverStarts += 1;
      return { baseUrl: "http://opencode.test", dispose() {} };
    };
    const adapter = new OpenCodeSdkAdapter({
      serverFactory,
      versionExecutor,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/agent") {
          agentRequests += 1;
          return Response.json([
            {
              name: "fusion-worker",
              permission: [
                { permission: "*", pattern: "*", action: "deny" },
                { permission: "bash", pattern: "*", action: "allow" },
              ],
            },
          ]);
        }
        if (url.pathname === "/session" && init?.method === "POST") {
          sessionRequests += 1;
          return Response.json({ id: "should-not-exist" });
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      },
    });

    const [first, second] = await Promise.all([
      adapter.runWorker(workerRequest()),
      adapter.runWorker({ ...workerRequest(), workerId: "worker-2" }),
    ]);
    await adapter.dispose();

    expect(first.status).toBe("error");
    expect(second.status).toBe("error");
    expect(first.errors?.join("\n")).toContain(
      "OPENCODE_EFFECTIVE_RULES_MISMATCH",
    );
    expect(first.errors?.join("\n")).toContain('"expected"');
    expect(first.errors?.join("\n")).toContain('"observed"');
    expect(serverStarts).toBe(1);
    expect(agentRequests).toBe(1);
    expect(sessionRequests).toBe(0);
  });

  test("disposes the run-scoped server after worker failure", async () => {
    let disposed = false;
    const serverFactory: OpenCodeServerFactory = async () => ({
      baseUrl: "http://opencode.test",
      dispose() {
        disposed = true;
      },
    });
    const adapter = new OpenCodeSdkAdapter({
      serverFactory,
      versionExecutor: versionExecutor,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/session" && init?.method === "POST") {
          return Response.json({ id: "session-1" });
        }
        if (url.pathname === "/event") {
          return new Response(
            new ReadableStream<Uint8Array>({
              start() {},
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          );
        }
        if (url.pathname === "/session/session-1/prompt_async") {
          return new Response("boom", { status: 500 });
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      },
    });

    const result = await adapter.runWorker(workerRequest());
    await adapter.dispose();

    expect(result.status).toBe("error");
    expect(disposed).toBe(true);
  });

  test("applies the worker timeout to the prompt POST", async () => {
    const adapter = new OpenCodeSdkAdapter({
      baseUrl: "http://opencode.test",
      versionExecutor: versionExecutor,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/session" && init?.method === "POST") {
          return Response.json({ id: "session-1" });
        }
        if (url.pathname === "/event") {
          return new Response(
            new ReadableStream<Uint8Array>({
              start() {},
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          );
        }
        if (url.pathname === "/session/session-1/prompt_async") {
          return new Promise<Response>(() => {});
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      },
    });

    const result = await adapter.runWorker({
      ...workerRequest(),
      budget: { timeoutMs: 50 },
    });

    expect(result.status).toBe("timeout");
    expect(result.errors?.join("\n")).toContain("sending the prompt");
  });

  test("returns an error result when the opencode binary cannot spawn", async () => {
    const serverFactory: OpenCodeServerFactory = async () => {
      throw new Error("opencode serve failed to spawn: ENOENT");
    };
    const adapter = new OpenCodeSdkAdapter({
      command: "fusion-test-missing-opencode-binary",
      serverFactory,
      versionExecutor: versionExecutor,
    });

    const result = await adapter.runWorker(workerRequest());
    await adapter.dispose();

    expect(result.status).toBe("error");
    expect(result.errors?.join("\n")).toContain("failed to spawn");
  });
});

function sse(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function sseResponse(render: () => Promise<string>): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        controller.enqueue(encoder.encode(await render()));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function openSseResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start() {},
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function completedAnswerSse(messageId: string, text: string): string {
  return [
    sse({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "session-1",
          messageID: assistantMessageId(messageId),
          type: "text",
          text,
        },
      },
    }),
    sse({
      type: "message.updated",
      properties: {
        info: assistantMessage(assistantMessageId(messageId)),
      },
    }),
  ].join("");
}

async function versionExecutor() {
  return {
    exitCode: 0,
    stdout: "1.17.13\n",
    stderr: "",
    durationMs: 1,
  };
}

async function waitForValue<T>(read: () => T | undefined): Promise<T> {
  for (let index = 0; index < 100; index += 1) {
    const value = read();
    if (value !== undefined) {
      return value;
    }
    await Bun.sleep(1);
  }
  throw new Error("timed out waiting for fake prompt body");
}

function assistantMessage(id: string) {
  return {
    id,
    sessionID: "session-1",
    role: "assistant",
    providerID: "openai",
    modelID: "gpt-5.5",
    finish: "stop",
    time: { created: 1, completed: 2 },
    parentID: "user-1",
    mode: "build",
    path: { cwd: "/workspace", root: "/workspace" },
    cost: 0.03,
    tokens: {
      input: 10,
      output: 20,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  };
}

function assistantMessageId(promptMessageId: string): string {
  return `${promptMessageId}-assistant`;
}
