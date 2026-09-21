import { describe, expect, test } from "bun:test";
import { readdir, access } from "node:fs/promises";
import {
  OpenCodeSdkAdapter,
  buildOpenCodeConfigContent,
  buildOpenCodePermissionRules,
  splitOpenCodeModel,
  type OpenCodeSdkAdapterOptions,
  type OpenCodeServerFactoryInput,
  type WorkerRequest,
} from "../lib/protocol";
import { withFusionPanelDepth, workerRequest } from "./fixtures";

type Event = { type: string; data: Record<string, unknown> };
const encoder = new TextEncoder();
const event = (
  type: string,
  data: Record<string, unknown> = {},
  sessionID = "ses_1",
): Event => ({ type, data: { sessionID, ...data } });
const started = (id = "msg_answer") =>
  event("session.step.started", {
    assistantMessageID: id,
    agent: "fusion-worker",
    model: { providerID: "observed", id: "actual-model" },
  });
const text = (value = "final answer", id = "msg_answer", ordinal = 0) =>
  event("session.text.ended", { assistantMessageID: id, ordinal, text: value });
const ended = (id = "msg_answer", finish = "stop") =>
  event("session.step.ended", {
    assistantMessageID: id,
    finish,
    cost: 0.02,
    tokens: {
      input: 12,
      output: 4,
      reasoning: 2,
      cache: { read: 0, write: 0 },
    },
  });
const succeeded = () => event("session.execution.succeeded");
const finalEvents = () => [
  event("session.execution.started"),
  started(),
  text(),
  ended(),
  succeeded(),
];
const versionExecutor = async () => ({
  exitCode: 0,
  stdout: "opencode v2.0.12\n",
  stderr: "",
  durationMs: 1,
});

function fixture(
  options: {
    request?: WorkerRequest;
    events?: Event[];
    version?: string;
    agentData?: unknown[];
    override?: (
      url: URL,
      init: RequestInit | undefined,
    ) => Response | Promise<Response> | undefined;
    handshake?: boolean;
    adapter?: Partial<OpenCodeSdkAdapterOptions>;
  } = {},
) {
  const request = options.request ?? workerRequest();
  const operations: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  let sessionCount = 0;
  let activeSession = "ses_1";
  let promptCount = 0;
  let agentCount = 0;
  const emit = (events: Event[]) => {
    for (const item of events)
      for (const stream of streams) {
        try {
          stream.enqueue(
            encoder.encode(`data: ${JSON.stringify(item)}\r\n\r\n`),
          );
        } catch {
          /* A prior worker may already have disconnected. */
        }
      }
  };
  const fetch: NonNullable<OpenCodeSdkAdapterOptions["fetch"]> = async (
    input,
    init,
  ) => {
    const url = new URL(String(input));
    operations.push(`${init?.method ?? "GET"} ${url.pathname}`);
    expect(new Headers(init?.headers).get("authorization")).toMatch(/^Basic /);
    expect(init?.redirect).toBe("error");
    const override = options.override?.(url, init);
    if (override !== undefined) return override;
    if (url.pathname === "/api/info")
      return Response.json({
        version: options.version ?? "2.0.12",
        pid: 10,
        urls: [],
        paths: { tmp: "/tmp" },
      });
    if (url.pathname === "/api/agent") {
      agentCount++;
      expect(url.searchParams.get("location[directory]")).toBe(
        request.environment?.workingDirectory ??
          request.environment?.workspaceRoot ??
          null,
      );
      const config = buildOpenCodeConfigContent({
        toolsPolicy: request.toolsPolicy,
        environment: request.environment,
      });
      return Response.json({
        location: { directory: "/workspace" },
        data:
          options.agentData ??
          Object.entries(config.agents).map(([id, agent]) => ({
            id,
            ...agent,
          })),
      });
    }
    if (url.pathname === "/api/session") {
      sessionCount++;
      activeSession = `ses_${sessionCount}`;
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return Response.json({
        data: {
          id: activeSession,
          agent: body.agent,
          model: body.model,
          location: body.location,
        },
      });
    }
    if (url.pathname === "/api/event") {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streams.push(controller);
            if (options.handshake !== false)
              controller.enqueue(
                encoder.encode(
                  'data: {"type":"server.connected","data":{}}\n\n',
                ),
              );
            init?.signal?.addEventListener(
              "abort",
              () => {
                operations.push("SSE disconnected");
                try {
                  controller.close();
                } catch {
                  /* Already cancelled by the reader. */
                }
              },
              { once: true },
            );
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    }
    if (url.pathname.endsWith("/prompt")) {
      promptCount++;
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      const events = (options.events ?? finalEvents()).map((item) => ({
        ...item,
        data: {
          ...item.data,
          sessionID:
            item.data.sessionID === "ses_1"
              ? activeSession
              : item.data.sessionID,
        },
      }));
      emit(events);
      return Response.json({
        data: { id: body.id, sessionID: activeSession, type: "user" },
      });
    }
    if (url.pathname.endsWith("/interrupt"))
      return Response.json({ interrupted: false });
    if (url.pathname.endsWith("/reply")) {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected endpoint ${url.pathname}`);
  };
  const adapter = new OpenCodeSdkAdapter({
    baseUrl: "http://opencode.test",
    serverPassword: "fixture-secret",
    fetch,
    ...options.adapter,
  });
  return {
    adapter,
    request,
    operations,
    bodies,
    emit,
    streams,
    fetch,
    counts: () => ({ sessionCount, promptCount, agentCount }),
  };
}

describe("Fusion OpenCode v2 SDK adapter", () => {
  test("maps native machine-protocol evidence and sends the exact rendered prompt", async () => {
    const f = fixture();
    const result = await f.adapter.runWorker(f.request);
    expect(result.status).toBe("ok");
    expect(result.output).toBe("final answer");
    expect(result.modelUsed).toBe("observed/actual-model");
    expect(result.harnessUsed?.version).toBe("2.0.12");
    expect(result.sessionId).toBe("ses_1");
    expect(result.usage).toMatchObject({
      inputTokens: 12,
      outputTokens: 4,
      costUsd: 0.02,
    });
    expect(result.complianceEvidence?.enforcement?.source).toBe(
      "verified-effective",
    );
    expect(f.bodies[0]).toMatchObject({
      agent: "fusion-worker",
      model: { providerID: "openai", id: "gpt-5.5" },
      location: { directory: "/workspace" },
    });
    expect(f.bodies[1]?.text).toBe(f.request.prompt);
    expect(Object.keys(f.bodies[1]!).sort()).toEqual(["id", "text"]);
    expect(f.operations.indexOf("GET /api/agent")).toBeLessThan(
      f.operations.indexOf("POST /api/session"),
    );
    expect(
      f.operations.indexOf("POST /api/session/ses_1/interrupt"),
    ).toBeLessThan(f.operations.indexOf("SSE disconnected"));
    expect(result.complianceEvidence?.enforcement?.abortOutcome).toEqual({
      attempted: true,
      succeeded: true,
    });
  });

  test("ignores private reasoning, deltas and other-session events", async () => {
    const f = fixture({
      events: [
        started(),
        event("session.reasoning.ended", { text: "PRIVATE" }),
        event("session.text.delta", {
          assistantMessageID: "msg_answer",
          ordinal: 0,
          delta: "duplicate",
        }),
        text(),
        ended(),
        event(
          "permission.asked",
          { id: "per_other", action: "edit" },
          "ses_other",
        ),
        event(
          "session.execution.failed",
          { error: { message: "foreign" } },
          "ses_other",
        ),
        succeeded(),
      ],
    });
    const result = await f.adapter.runWorker(f.request);
    expect(result.status).toBe("ok");
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(result.output).toBe("final answer");
    expect(f.operations.some((item) => item.includes("/reply"))).toBe(false);
  });

  test("waits past tool steps and sums per-step usage without duplicating boundaries", async () => {
    const f = fixture({
      events: [
        started("first"),
        text("intermediate", "first"),
        ended("first", "tool-calls"),
        ended("first", "tool-calls"),
        started(),
        text("tail", "msg_answer", 1),
        text("head", "msg_answer", 0),
        ended(),
        succeeded(),
      ],
    });
    const result = await f.adapter.runWorker(f.request);
    expect(result.status).toBe("ok");
    expect(result.output).toBe("head\ntail");
    expect(result.usage).toMatchObject({
      inputTokens: 24,
      outputTokens: 8,
      costUsd: 0.04,
    });
  });

  test("rejects unexpected permission asks with feedback and deduplicates denial evidence", async () => {
    const f = fixture({
      events: [
        started(),
        event("session.tool.input.started", { id: "call_1", name: "shell" }),
        event("session.tool.called", {
          id: "call_1",
          input: { command: "git push" },
        }),
        event("permission.asked", {
          id: "per_1",
          action: "shell",
          source: { type: "tool", id: "call_1", messageID: "msg_answer" },
        }),
        event("session.tool.failed", {
          id: "call_1",
          error: {
            type: "permission.rejected",
            message: "Permission denied: shell",
          },
        }),
        text("denial disclosed"),
        ended(),
        succeeded(),
      ],
    });
    const result = await f.adapter.runWorker(f.request);
    expect(result.status).toBe("ok");
    expect(result.complianceEvidence?.enforcement?.permissionDenialCount).toBe(
      1,
    );
    expect(result.complianceEvidence?.enforcement?.toolEvents).toEqual([
      { tool: "shell", command: "git push", outcome: "denied" },
    ]);
    expect(f.bodies.at(-1)).toMatchObject({ decision: "reject" });
    expect(f.bodies.at(-1)?.message).toBeString();
  });

  test.each(["permission.rejected", "unknown"])(
    "classifies structured tool error %s",
    async (type) => {
      const f = fixture({
        events: [
          started(),
          event("session.tool.input.started", { id: "call_1", name: "read" }),
          event("session.tool.failed", {
            id: "call_1",
            error: { type, message: "failed" },
          }),
          event("session.tool.input.started", { id: "call_2", name: "read" }),
          event("session.tool.success", { id: "call_2" }),
          text(),
          ended(),
          succeeded(),
        ],
      });
      const result = await f.adapter.runWorker(f.request);
      expect(
        result.complianceEvidence?.enforcement?.permissionDenialCount,
      ).toBe(type === "permission.rejected" ? 1 : 0);
      expect(result.toolUseSummary?.toolsUsed).toContain("read");
      expect(
        result.complianceEvidence?.enforcement?.toolEvents?.[0]?.outcome,
      ).toBe(type === "permission.rejected" ? "denied" : "failed");
    },
  );

  test.each(["failed", "interrupted"])(
    "never treats execution %s as success",
    async (terminal) => {
      const f = fixture({
        events: [
          started(),
          text(),
          ended(),
          event(`session.execution.${terminal}`, {
            error: { message: "provider failed" },
            reason: "inactivity",
          }),
        ],
      });
      const result = await f.adapter.runWorker(f.request);
      expect(result.status).toBe("error");
      expect(result.errors?.join()).toContain(terminal);
      expect(
        result.complianceEvidence?.enforcement?.abortOutcome?.attempted,
      ).toBe(true);
    },
  );

  test("records retries without losing completion", async () => {
    const f = fixture({
      events: [
        event("session.retry.scheduled", { error: { message: "busy" } }),
        ...finalEvents(),
      ],
    });
    const result = await f.adapter.runWorker(f.request);
    expect(result.status).toBe("ok");
    expect(result.warnings?.join()).toContain("retrying");
  });

  test.each(["truncated", "malformed", "empty", "tool-only"])(
    "fails closed on %s stream/completion",
    async (kind) => {
      const f = fixture({
        events:
          kind === "empty"
            ? [started(), ended(), succeeded()]
            : kind === "tool-only"
              ? [
                  started(),
                  text(),
                  ended("msg_answer", "tool-calls"),
                  succeeded(),
                ]
              : [],
        override: (url) => {
          if (
            url.pathname !== "/api/event" ||
            !["truncated", "malformed"].includes(kind)
          )
            return undefined;
          return new Response(
            'data: {"type":"server.connected","data":{}}\n\n' +
              (kind === "malformed" ? "data: NOT-JSON\n\n" : ""),
            { headers: { "content-type": "text/event-stream" } },
          );
        },
      });
      const result = await f.adapter.runWorker(f.request);
      expect(result.status).toBe("error");
      expect(
        result.complianceEvidence?.enforcement?.abortOutcome?.attempted,
      ).toBe(true);
    },
  );

  test("waits for server.connected, not merely HTTP headers", async () => {
    const f = fixture({ handshake: false });
    const running = f.adapter.runWorker({
      ...f.request,
      budget: { timeoutMs: 1000 },
    });
    while (!f.streams.length) await Bun.sleep(1);
    expect(f.counts().promptCount).toBe(0);
    f.emit([{ type: "server.connected", data: {} }]);
    expect((await running).status).toBe("ok");
  });

  test.each(["prompt", "reply"])(
    "interrupts on %s HTTP failure without leaking response bodies",
    async (path) => {
      const f = fixture({
        events:
          path === "reply"
            ? [event("permission.asked", { id: "per_1", action: "edit" })]
            : [],
        override: (url) =>
          url.pathname.endsWith(`/${path}`)
            ? new Response("fixture-secret DO-NOT-RECORD", { status: 500 })
            : undefined,
      });
      const result = await f.adapter.runWorker(f.request);
      expect(result.status).toBe("error");
      expect(JSON.stringify(result)).not.toContain("fixture-secret");
      expect(JSON.stringify(result)).not.toContain("DO-NOT-RECORD");
      expect(
        result.complianceEvidence?.enforcement?.abortOutcome?.attempted,
      ).toBe(true);
    },
  );

  test.each(["prompt", "stream"])(
    "applies worker timeout to stalled %s",
    async (where) => {
      const f = fixture({
        events: [],
        override: (url) =>
          where === "prompt" && url.pathname.endsWith("/prompt")
            ? new Promise<Response>(() => {})
            : undefined,
      });
      const result = await f.adapter.runWorker({
        ...f.request,
        budget: { timeoutMs: 30 },
      });
      expect(result.status).toBe("timeout");
      expect(
        result.complianceEvidence?.enforcement?.abortOutcome?.succeeded,
      ).toBe(true);
      expect(
        f.operations.indexOf("POST /api/session/ses_1/interrupt"),
      ).toBeLessThan(f.operations.indexOf("SSE disconnected"));
    },
  );

  test("cleanup failure is disclosed without retroactively failing completed output", async () => {
    const f = fixture({
      override: (url) =>
        url.pathname.endsWith("/interrupt")
          ? new Response(null, { status: 500 })
          : undefined,
    });
    const result = await f.adapter.runWorker(f.request);
    expect(result.status).toBe("ok");
    expect(
      result.complianceEvidence?.enforcement?.abortOutcome?.succeeded,
    ).toBe(false);
    expect(result.warnings?.join()).toContain("interrupt failed");
  });

  test.each(["1.18.31", "2.0.11", "2.1.0", "3.0.0", "unknown"])(
    "rejects unsupported server version %s before sessions/models",
    async (version) => {
      const f = fixture({ version });
      const result = await f.adapter.runWorker(f.request);
      expect(result.status).toBe("error");
      expect(result.errors?.join()).toContain("Unsupported OpenCode");
      expect(f.counts().sessionCount).toBe(0);
    },
  );

  test("injected server uses server identity, not the local CLI, and requires explicit auth", async () => {
    const f = fixture({
      adapter: {
        versionExecutor: async () => {
          throw new Error("must not query local CLI");
        },
      },
    });
    expect((await f.adapter.runWorker(f.request)).status).toBe("ok");
    await f.adapter.dispose();
    const missing = fixture({ adapter: { serverPassword: undefined } });
    expect(
      (await missing.adapter.runWorker(missing.request)).errors?.join(),
    ).toContain("serverPassword");
    expect(missing.operations).toEqual([]);
  });

  test.each([
    "removed",
    "reordered",
    "extra-allow",
    "unknown-only-deny",
    "read-root",
  ])("rejects %s effective policy before creating sessions", async (kind) => {
    const request = workerRequest();
    request.environment!.readRoots = ["/declared"];
    if (kind === "unknown-only-deny")
      request.toolsPolicy = { ...request.toolsPolicy!, deny: ["future_tool"] };
    const config = buildOpenCodeConfigContent({
      toolsPolicy: request.toolsPolicy,
      environment: request.environment,
    });
    const worker = config.agents["fusion-worker"]!;
    if (kind === "removed") worker.permissions = [];
    if (kind === "reordered") worker.permissions.reverse();
    if (kind === "extra-allow")
      worker.permissions.push({
        action: "shell",
        resource: "git push",
        effect: "allow",
      });
    if (kind === "unknown-only-deny")
      worker.permissions.push({
        action: "future_tool",
        resource: "*",
        effect: "allow",
      });
    if (kind === "read-root") worker.permissions.pop();
    const f = fixture({
      request,
      agentData: Object.entries(config.agents).map(([id, agent]) => ({
        id,
        ...agent,
      })),
    });
    const result = await f.adapter.runWorker(request);
    expect(result.errors?.join()).toContain(
      "OPENCODE_EFFECTIVE_RULES_MISMATCH",
    );
    expect(f.counts().sessionCount).toBe(0);
  });

  test("waits for initially empty asynchronous agent registration, then verifies", async () => {
    let calls = 0;
    const f = fixture({
      override: (url) =>
        url.pathname === "/api/agent" && calls++ === 0
          ? Response.json({ data: [] })
          : undefined,
    });
    expect((await f.adapter.runWorker(f.request)).status).toBe("ok");
    expect(calls).toBe(2);
  });

  test("checks judge rules before the worker, and rechecks rules before each invocation", async () => {
    const config = buildOpenCodeConfigContent({
      toolsPolicy: workerRequest().toolsPolicy,
      environment: workerRequest().environment,
    });
    config.agents["fusion-judge"]!.permissions.push({
      action: "read",
      resource: "*",
      effect: "allow",
    });
    const f = fixture({
      agentData: Object.entries(config.agents).map(([id, agent]) => ({
        id,
        ...agent,
      })),
    });
    expect((await f.adapter.runWorker(f.request)).status).toBe("error");
    expect(f.counts().promptCount).toBe(0);
    const normal = fixture();
    expect((await normal.adapter.runWorker(normal.request)).status).toBe("ok");
    expect(
      (
        await normal.adapter.runWorker({
          ...normal.request,
          toolsPolicy: { mode: "none" },
        })
      ).status,
    ).toBe("ok");
    expect(normal.bodies[2]?.agent).toBe("fusion-judge");
    expect(normal.counts().agentCount).toBe(2);
  });

  test.each(["deny", "readRoots", "directory"])(
    "rejects different shared-server %s",
    async (kind) => {
      const f = fixture();
      expect((await f.adapter.runWorker(f.request)).status).toBe("ok");
      const changed = structuredClone(f.request);
      if (kind === "deny") changed.toolsPolicy!.deny = ["Read"];
      if (kind === "readRoots") changed.environment!.readRoots = ["/elsewhere"];
      if (kind === "directory")
        changed.environment!.workingDirectory = "/elsewhere";
      const result = await f.adapter.runWorker(changed);
      expect(result.errors?.join()).toContain(
        "OPENCODE_SHARED_SERVER_POLICY_MISMATCH",
      );
      expect(f.counts().promptCount).toBe(1);
    },
  );

  test.each([undefined, "1"])(
    "isolates owned config, increments depth %s, and cleans on disposal",
    async (parentDepth) => {
      await withFusionPanelDepth(parentDepth, async () => {
        let captured: OpenCodeServerFactoryInput | undefined;
        let disposed = 0;
        const f = fixture();
        const adapter = new OpenCodeSdkAdapter({
          fetch: f.fetch,
          versionExecutor,
          serverFactory: async (input) => {
            captured = input;
            expect(await readdir(input.env.OPENCODE_CONFIG_DIR!)).toEqual([]);
            expect(input.env.XDG_CONFIG_HOME).toBe(
              input.env.OPENCODE_CONFIG_DIR,
            );
            expect(input.env.OPENCODE_CONFIG).toBeUndefined();
            expect(input.env.OPENCODE_PASSWORD).toBeString();
            return {
              baseUrl: "http://opencode.test",
              dispose() {
                disposed++;
              },
            };
          },
        });
        expect((await adapter.runWorker(f.request)).status).toBe("ok");
        expect(captured?.env.FUSION_PANEL_DEPTH).toBe(
          parentDepth === undefined ? "1" : "2",
        );
        await adapter.dispose();
        expect(disposed).toBe(1);
        await expect(
          access(captured!.env.OPENCODE_CONFIG_DIR!),
        ).rejects.toThrow();
      });
    },
  );

  test("rejects v1 locally without starting a server", async () => {
    let spawned = false;
    const adapter = new OpenCodeSdkAdapter({
      versionExecutor: async () => ({
        exitCode: 0,
        stdout: "1.18.31\n",
        stderr: "",
        durationMs: 1,
      }),
      serverFactory: async () => {
        spawned = true;
        throw Error("never");
      },
    });
    const result = await adapter.runWorker(workerRequest());
    expect(result.status).toBe("error");
    expect(spawned).toBe(false);
  });

  test("reports missing binary without an uncaught spawn error", async () => {
    const adapter = new OpenCodeSdkAdapter({
      command: "/missing/fusion-opencode",
    });
    const result = await adapter.runWorker(workerRequest());
    expect(result.status).toBe("error");
    await adapter.dispose();
  });

  test("keeps unsupported preference warnings instead of silently claiming mapping", async () => {
    const f = fixture();
    const result = await f.adapter.runWorker({
      ...f.request,
      reasoning: { effort: "high", maxTokens: 500 },
      budget: { maxTurns: 3 },
    });
    expect(result.warnings?.join()).toContain("reasoning.effort");
    expect(result.warnings?.join()).toContain("reasoning.maxTokens");
    expect(result.warnings?.join()).toContain("budget.maxTurns");
    expect(splitOpenCodeModel("provider/model/name#high")).toEqual({
      providerID: "provider",
      id: "model/name",
      variant: "high",
    });
    expect(() => splitOpenCodeModel("unqualified")).toThrow();
  });

  test("native rules retain deny-wins, read roots and no-tools judge without deprecated fields", () => {
    const rules = buildOpenCodePermissionRules(
      { mode: "full", deny: ["Bash", "WebFetch", "Write"] },
      { readRoots: ["/declared/"] },
    );
    expect(rules[0]).toEqual({ action: "*", resource: "*", effect: "deny" });
    expect(
      rules.some(
        (rule) =>
          ["shell", "webfetch", "edit"].includes(rule.action) &&
          rule.effect === "allow",
      ),
    ).toBe(false);
    expect(rules).toContainEqual({
      action: "external_directory",
      resource: "/declared/**",
      effect: "allow",
    });
    const none = buildOpenCodePermissionRules(
      { mode: "none", allow: ["Read"] },
      { readRoots: ["/declared"] },
    );
    expect(none).toEqual([{ action: "*", resource: "*", effect: "deny" }]);
    const config = buildOpenCodeConfigContent({
      toolsPolicy: workerRequest().toolsPolicy,
      environment: undefined,
    });
    expect(config).not.toHaveProperty("experimental");
    expect(config).not.toHaveProperty("agent");
    expect(JSON.stringify(config)).not.toContain('"tools"');
    expect(config.warming).toBe(false);
  });
});
