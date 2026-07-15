import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  buildOpenCodeConfigContent,
  defaultPolicies,
} from "../lib/protocol";

const opencode = Bun.which("opencode");
const integrationPort =
  opencode === null ? null : await availablePort().catch(() => null);

describe("Fusion OpenCode containment integration", () => {
  test.skipIf(opencode === null || integrationPort === null)(
    "injects the expected effective agent rules without calling a model",
    async () => {
      const workspace = await mkdtemp(join(tmpdir(), "fusion-opencode-rules-"));
      const port = integrationPort as number;
      const baseUrl = `http://127.0.0.1:${port}`;
      const config = buildOpenCodeConfigContent({
        toolsPolicy: defaultPolicies.tools,
        environment: { workspaceRoot: workspace },
      });
      const child = spawn(
        opencode as string,
        ["serve", "--pure", "--hostname", "127.0.0.1", "--port", String(port)],
        {
          cwd: workspace,
          env: {
            ...process.env,
            OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const output: Buffer[] = [];
      child.stdout?.on("data", (chunk) => output.push(Buffer.from(chunk)));
      child.stderr?.on("data", (chunk) => output.push(Buffer.from(chunk)));

      try {
        const agents = await waitForAgents(child, baseUrl, output);
        const agent = agents.find(
          (candidate) => candidate.name === "fusion-worker",
        );
        expect(agent).toBeDefined();
        const rules = agent?.permission ?? [];
        expect(rules).toContainEqual({
          permission: "*",
          pattern: "*",
          action: "deny",
        });
        expect(rules).toContainEqual({
          permission: "bash",
          pattern: "*",
          action: "deny",
        });
        for (const command of defaultPolicies.tools.readOnlyBashCommands ?? []) {
          expect(rules).toContainEqual({
            permission: "bash",
            pattern: command,
            action: "allow",
          });
          expect(rules).toContainEqual({
            permission: "bash",
            pattern: `${command} *`,
            action: "allow",
          });
        }
        for (const permission of ["read", "grep", "glob"] as const) {
          expect(rules).toContainEqual({
            permission,
            pattern: "*",
            action: "allow",
          });
        }
        expect(rules).toContainEqual({
          permission: "webfetch",
          pattern: "*",
          action: "allow",
        });
        expect(rules).toContainEqual({
          permission: "websearch",
          pattern: "*",
          action: "allow",
        });
        const judge = agents.find(
          (candidate) => candidate.name === "fusion-judge",
        );
        expect(judge).toBeDefined();
        for (const permission of [
          "read",
          "grep",
          "glob",
          "webfetch",
          "websearch",
        ]) {
          expect(
            effectiveDecision(judge?.permission ?? [], permission, "*"),
          ).toBe("deny");
        }
        expect(
          effectiveDecision(
            judge?.permission ?? [],
            "bash",
            "git status",
          ),
        ).toBe("deny");

        // noReply applies prompt fields and persists the user message before
        // returning, but exits before OpenCode enters the model loop.
        const session = await requestJson<{ id: string }>(baseUrl, "/session", {
          method: "POST",
          body: { title: "Fusion containment integration" },
        });
        await requestJson(baseUrl, `/session/${session.id}/message`, {
          method: "POST",
          body: {
            messageID: "msg_fusioncontainment",
            agent: "fusion-worker",
            noReply: true,
            parts: [{ type: "text", text: "Containment shape check" }],
          },
        });
        const persisted = await requestJson<{ permission?: unknown }>(
          baseUrl,
          `/session/${session.id}`,
        );
        expect(persisted.permission).toBeUndefined();
        await requestJson(baseUrl, `/session/${session.id}/abort`, {
          method: "POST",
        });
      } finally {
        await stopChild(child);
        await rm(workspace, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

interface AgentResponse {
  name: string;
  permission: Array<{
    permission: string;
    pattern: string;
    action: "ask" | "allow" | "deny";
  }>;
}

function effectiveDecision(
  rules: AgentResponse["permission"],
  permission: string,
  pattern: string,
): "ask" | "allow" | "deny" | undefined {
  return rules.findLast(
    (rule) =>
      globMatches(rule.permission, permission) &&
      globMatches(rule.pattern, pattern),
  )?.action;
}

function globMatches(glob: string, value: string): boolean {
  if (glob.endsWith(" *") && value === glob.slice(0, -2)) {
    return true;
  }
  const pattern = glob
    .split("*")
    .map((part) => part.replace(/[\\^$+?.()|[\]{}]/gu, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}$`, "u").test(value);
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("failed to allocate an OpenCode integration test port");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return address.port;
}

async function waitForAgents(
  child: ChildProcess,
  baseUrl: string,
  output: Buffer[],
): Promise<AgentResponse[]> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(
        `opencode serve exited with ${child.exitCode}: ${Buffer.concat(output).toString("utf8")}`,
      );
    }
    try {
      return await requestJson<AgentResponse[]>(baseUrl, "/agent");
    } catch {
      await Bun.sleep(50);
    }
  }
  throw new Error(
    `opencode serve did not become ready: ${Buffer.concat(output).toString("utf8")}`,
  );
}

async function requestJson<T = unknown>(
  baseUrl: string,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    method: init.method ?? "GET",
    headers:
      init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${path} failed with ${response.status}: ${await response.text()}`,
    );
  }
  const text = await response.text();
  return (text.length === 0 ? undefined : JSON.parse(text)) as T;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve())
  );
  const terminated = await Promise.race([
    exited.then(() => true),
    Bun.sleep(1_000).then(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
      return false;
    }),
  ]);
  if (!terminated) {
    await exited;
  }
}
