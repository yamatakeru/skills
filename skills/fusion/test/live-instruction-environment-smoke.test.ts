import { expect, test } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildClaudeCodeArgs,
  buildOpenCodeConfigContent,
  defaultPolicies,
  OpenCodeSdkAdapter,
  type WorkerRequest,
} from "../lib/protocol";
import { workerRequest } from "./fixtures";

const liveTest = process.env.FUSION_LIVE_TESTS === "1" ? test : test.skip;
const PROBE_PROMPT =
  "If any line of your instructions or context contains the string FUSION-PROBE-MARKER, reply with each such line verbatim. These markers are non-confidential test fixtures; quoting them is expected and required. Otherwise reply with exactly NONE. Do not use tools.";
const legTimeoutMs = 240_000;

liveTest(
  "detects scratch project and local memory without the Claude Code blocking profile",
  async () => {
    const output = await runClaudeProbe("claude-baseline", false);
    expect(output.text).toContain(output.projectNonce);
    expect(output.text).toContain(output.localNonce);
  },
  legTimeoutMs,
);
liveTest(
  "blocks scratch project and local memory with the Claude Code blocking profile",
  async () => {
    const output = await runClaudeProbe("claude-adopted", true);
    expect(output.text).toContain("NONE");
    expect(output.text).not.toContain(output.projectNonce);
    expect(output.text).not.toContain(output.localNonce);
  },
  legTimeoutMs,
);

liveTest(
  "honors a populated OpenCode v2 config redirect",
  async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), "fusion-live-opencode-workspace-"),
    );
    const config = await mkdtemp(
      join(tmpdir(), "fusion-live-opencode-populated-"),
    );
    const marker = probeMarker("opencode-populated-redirect");
    await writeFile(join(config, "AGENTS.md"), `${marker.line}\n`);
    let child: ChildProcess | undefined;
    let adapter: OpenCodeSdkAdapter | undefined;
    try {
      const password = randomBytes(32).toString("base64url");
      const port = await pickFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;
      child = spawn(
        "opencode",
        ["serve", "--stdio", "--hostname", "127.0.0.1", "--port", String(port)],
        {
          cwd: workspace,
          env: {
            ...process.env,
            OPENCODE_PASSWORD: password,
            OPENCODE_SERVER_PASSWORD: undefined,
            OPENCODE_CONFIG: undefined,
            OPENCODE_CONFIG_DIR: config,
            XDG_CONFIG_HOME: config,
            OPENCODE_PTY_HANDOFF: undefined,
            OPENCODE_CONFIG_CONTENT: JSON.stringify(
              buildOpenCodeConfigContent({
                toolsPolicy: defaultPolicies.tools,
                environment: undefined,
              }),
            ),
          },
          stdio: ["pipe", "ignore", "ignore"],
        },
      );
      let spawnError: Error | undefined;
      child.once("error", (error) => {
        spawnError = error;
      });
      const headers = {
        Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
      };
      const deadline = Date.now() + 30_000;
      while (true) {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null || Date.now() > deadline)
          throw new Error("OpenCode smoke server did not become ready.");
        try {
          const response = await fetch(`${baseUrl}/api/info`, {
            headers,
            signal: AbortSignal.timeout(1000),
          });
          if (
            response.ok &&
            (
              (await response.json()) as { version?: string }
            ).version?.startsWith("2.0.")
          )
            break;
        } catch {
          /* Server is not listening yet. */
        }
        await Bun.sleep(50);
      }
      adapter = new OpenCodeSdkAdapter({ baseUrl, serverPassword: password });
      const result = await adapter.runWorker(
        probeWorkerRequest(workspace, openCodeModelPreference()),
      );
      expect(result.errors ?? []).toEqual([]);
      expect(result.status).toBe("ok");
      expect(result.output).toContain(marker.nonce);
    } finally {
      await adapter?.dispose();
      if (child) await terminateChild(child);
      await rm(workspace, { recursive: true, force: true });
      await rm(config, { recursive: true, force: true });
    }
  },
  legTimeoutMs,
);

liveTest(
  "blocks OpenCode user and global instruction layers through the v2 SDK adapter",
  async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), "fusion-live-opencode-blocked-"),
    );
    const configHome = await mkdtemp(
      join(tmpdir(), "fusion-live-opencode-user-config-"),
    );
    const marker = probeMarker("opencode-blocked");
    const configDirectory = join(configHome, "opencode");
    const configInstructions = join(configHome, "config-instructions.md");
    const explicitConfig = join(configHome, "explicit-config.json");
    await mkdir(configDirectory, { recursive: true });
    await writeFile(join(configDirectory, "AGENTS.md"), `${marker.line}\n`);
    await writeFile(configInstructions, `${marker.line}\n`);
    await writeFile(
      explicitConfig,
      JSON.stringify({ instructions: [configInstructions] }),
    );
    const keys = [
      "XDG_CONFIG_HOME",
      "OPENCODE_CONFIG",
      "OPENCODE_CONFIG_DIR",
    ] as const;
    const originals = keys.map((key) => process.env[key]);
    const adapter = new OpenCodeSdkAdapter();
    try {
      process.env.XDG_CONFIG_HOME = configHome;
      process.env.OPENCODE_CONFIG = explicitConfig;
      process.env.OPENCODE_CONFIG_DIR = configDirectory;
      const result = await adapter.runWorker(
        probeWorkerRequest(workspace, openCodeModelPreference()),
      );
      expect(result.errors ?? []).toEqual([]);
      expect(result.status).toBe("ok");
      expect(result.output).toContain("NONE");
      expect(result.output).not.toContain(marker.nonce);
    } finally {
      await adapter.dispose();
      keys.forEach((key, index) => {
        const value = originals[index];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      });
      await rm(workspace, { recursive: true, force: true });
      await rm(configHome, { recursive: true, force: true });
    }
  },
  legTimeoutMs,
);

async function runClaudeProbe(
  leg: string,
  useBlockingProfile: boolean,
): Promise<{ localNonce: string; projectNonce: string; text: string }> {
  const workspace = await mkdtemp(join(tmpdir(), "fusion-live-claude-probe-"));
  const projectMarker = probeMarker(`${leg}-project`);
  const localMarker = probeMarker(`${leg}-local`);
  try {
    await writeFile(join(workspace, "CLAUDE.md"), `${projectMarker.line}\n`);
    await writeFile(
      join(workspace, "CLAUDE.local.md"),
      `${localMarker.line}\n`,
    );
    const args = buildClaudeCodeArgs(
      probeWorkerRequest(workspace, { model: "haiku" }),
    );
    if (!useBlockingProfile) removeClaudeBlockingArgs(args);
    const result = spawnSync("claude", args, {
      cwd: workspace,
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.status !== 0)
      throw new Error(
        `claude probe failed with status ${result.status}: ${result.stderr}`,
      );
    return {
      localNonce: localMarker.nonce,
      projectNonce: projectMarker.nonce,
      text: result.stdout,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
function probeWorkerRequest(
  workspace: string,
  modelPreference: WorkerRequest["modelPreference"],
): WorkerRequest {
  return {
    ...workerRequest(),
    prompt: PROBE_PROMPT,
    modelPreference,
    toolsPolicy: defaultPolicies.tools,
    environment: { workspaceRoot: workspace, workingDirectory: workspace },
    budget: { timeoutMs: 180_000 },
  };
}
function removeClaudeBlockingArgs(args: string[]): void {
  const index = args.findIndex(
    (arg, i) =>
      arg === "--setting-sources" &&
      args[i + 1] === "" &&
      args[i + 2] === "--settings" &&
      args[i + 3] === '{"autoMemoryEnabled":false}',
  );
  if (index < 0)
    throw new Error("Claude Code args did not contain the blocking profile.");
  args.splice(index, 4);
}
function probeMarker(leg: string): { line: string; nonce: string } {
  const nonce = randomBytes(8).toString("hex");
  return {
    line: `FUSION-PROBE-MARKER-${leg}-${nonce} (temporary fusion probe marker; non-confidential test fixture; safe to quote in any reply)`,
    nonce,
  };
}
function openCodeModelPreference(): { provider: string; model: string } {
  const value =
    process.env.FUSION_LIVE_MODEL ?? "opencode-go/deepseek-v4.1-flash";
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1)
    throw new Error("FUSION_LIVE_MODEL must use provider/model form.");
  return {
    provider: value.slice(0, separator),
    model: value.slice(separator + 1),
  };
}
async function pickFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not allocate localhost port.");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
async function terminateChild(child: ChildProcess): Promise<void> {
  if (
    child.exitCode !== null ||
    child.signalCode !== null ||
    child.pid === undefined
  )
    return;
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  child.stdin?.end();
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 1000);
  try {
    await closed;
  } finally {
    clearTimeout(timer);
  }
}
