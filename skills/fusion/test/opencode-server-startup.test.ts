import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCodeSdkAdapter } from "../lib/protocol";
import { workerRequest } from "./fixtures";

type Attempt = { pid: number; port: number };
type Scenario =
  | "first-exit"
  | "always-exit"
  | "http-401"
  | "http-403"
  | "http-404"
  | "unsupported-version"
  | "invalid-identity";

// Exercise the production process owner against a fake local executable. It
// implements readiness only and never exposes a model-execution endpoint.
async function probe(scenario: Scenario) {
  const workspace = await mkdtemp(join(tmpdir(), "fusion-startup-test-"));
  const command = join(workspace, "opencode-fixture");
  const log = join(workspace, "attempts.jsonl");
  await writeFile(log, "");
  await writeFile(
    command,
    `#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs";
const log = ${JSON.stringify(log)};
const scenario = ${JSON.stringify(scenario)};
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const attempt = readFileSync(log, "utf8").trim().split("\\n").filter(Boolean).length;
appendFileSync(log, JSON.stringify({ pid: process.pid, port }) + "\\n");
if (scenario === "always-exit" || (scenario === "first-exit" && attempt === 0)) process.exit(1);
const authorization = "Basic " + Buffer.from("opencode:" + process.env.OPENCODE_PASSWORD).toString("base64");
Bun.serve({
  hostname: "127.0.0.1", port,
  fetch(request) {
    if (request.headers.get("authorization") !== authorization) return new Response(null, {status:401});
    if (new URL(request.url).pathname !== "/api/info") return new Response(null, {status:500});
    if (scenario.startsWith("http-")) return new Response(null, {status:Number(scenario.slice(5))});
    return Response.json({
      version: scenario === "unsupported-version" ? "2.1.0" : "2.0.12",
      pid: scenario === "invalid-identity" ? "invalid" : process.pid,
      urls: [], paths: {tmp: ${JSON.stringify(workspace)}}
    });
  }
});
`,
  );
  await chmod(command, 0o700);
  const adapter = new OpenCodeSdkAdapter({
    command,
    versionExecutor: async () => ({
      exitCode: 0,
      stdout: "opencode v2.0.12\n",
      stderr: "",
      durationMs: 0,
    }),
  });
  try {
    const result = await adapter.runWorker({
      ...workerRequest(),
      environment: { workspaceRoot: workspace },
      budget: { timeoutMs: 5000 },
    });
    await adapter.dispose();
    const attempts = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Attempt);
    for (const { pid } of attempts) {
      // Reaping the failed child and disposing the last child are both required.
      expect(() => process.kill(pid, 0)).toThrow();
    }
    expect(result.status).toBe("error");
    expect(result.sessionId).toBeUndefined();
    return { attempts, errors: result.errors?.join("\n") ?? "" };
  } finally {
    await adapter.dispose();
    await rm(workspace, { recursive: true, force: true });
  }
}

describe("OpenCode owned-server startup retry", () => {
  test("reaps an early exit and retries once on a newly allocated port", async () => {
    const { attempts, errors } = await probe("first-exit");
    expect(attempts).toHaveLength(2);
    expect(attempts[1]?.port).not.toBe(attempts[0]?.port);
    // Getting this controlled response proves that the second server was ready.
    expect(errors).toContain("/api/agent failed with HTTP 500");
  });

  test("does not spawn a third process after two early exits", async () => {
    const { attempts, errors } = await probe("always-exit");
    expect(attempts).toHaveLength(2);
    expect(errors).toContain("OpenCode serve exited before readiness");
  });

  for (const [scenario, message] of [
    ["http-401", "HTTP 401"],
    ["http-403", "HTTP 403"],
    ["http-404", "HTTP 404"],
    ["unsupported-version", "Unsupported OpenCode version 2.1.0"],
    ["invalid-identity", "Invalid OpenCode server identity"],
  ] as const) {
    test(`fails closed without retry for ${scenario}`, async () => {
      const { attempts, errors } = await probe(scenario);
      expect(attempts).toHaveLength(1);
      expect(errors).toContain(message);
    });
  }
});
