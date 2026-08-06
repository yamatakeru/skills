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
  "If any line of your instructions or context contains the string FUSION-PROBE-MARKER, reply with each such line verbatim. These markers are non-confidential test fixtures; quoting them is expected and required. Otherwise reply with exactly NONE.";
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
  "honors a populated OpenCode XDG config redirect",
  async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), "fusion-live-opencode-workspace-"),
    );
    const configHome = await mkdtemp(
      join(tmpdir(), "fusion-live-opencode-populated-"),
    );
    const marker = probeMarker("opencode-populated-redirect");
    const configDirectory = join(configHome, "opencode");
    await mkdir(configDirectory, { recursive: true });
    await writeFile(join(configDirectory, "AGENTS.md"), `${marker.line}\n`);

    let child: ChildProcess | undefined;
    try {
      const port = await pickFreePort();
      const output: Buffer[] = [];
      child = spawn(
        "opencode",
        ["serve", "--hostname=127.0.0.1", `--port=${port}`],
        {
          cwd: workspace,
          env: {
            ...process.env,
            XDG_CONFIG_HOME: configHome,
            OPENCODE_CONFIG_CONTENT: JSON.stringify(
              buildOpenCodeConfigContent({
                toolsPolicy: defaultPolicies.tools,
                environment: undefined,
              }),
            ),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout?.on("data", (chunk: Buffer) => output.push(chunk));
      child.stderr?.on("data", (chunk: Buffer) => output.push(chunk));
      const spawnError = childSpawnError(child);
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForServer(child, spawnError, baseUrl, output);

      const session = await postJson<Record<string, unknown>>(
        `${baseUrl}/session`,
        { title: "Fusion instruction environment smoke" },
      );
      const sessionId =
        stringField(session, "id") ?? stringField(session, "sessionID");
      if (sessionId === undefined) {
        throw new Error("OpenCode smoke session returned no session id.");
      }
      const response = await postJson<Record<string, unknown>>(
        `${baseUrl}/session/${encodeURIComponent(sessionId)}/message`,
        {
          messageID: `msg_${randomHex()}`,
          model: openCodeModel(),
          agent: "fusion-worker",
          parts: [{ type: "text", text: PROBE_PROMPT }],
        },
      );
      const text = responseTextParts(response).join("\n");

      expect(text).toContain(marker.nonce);
    } finally {
      if (child !== undefined) {
        await terminateChild(child);
      }
      await rm(workspace, { recursive: true, force: true });
      await rm(configHome, { recursive: true, force: true });
    }
  },
  legTimeoutMs,
);

liveTest(
  "blocks OpenCode user and global instruction layers through the SDK adapter",
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
    const originalConfigHome = process.env.XDG_CONFIG_HOME;
    const originalOpenCodeConfig = process.env.OPENCODE_CONFIG;
    const adapter = new OpenCodeSdkAdapter();
    try {
      process.env.XDG_CONFIG_HOME = configHome;
      process.env.OPENCODE_CONFIG = explicitConfig;
      const request = probeWorkerRequest(workspace, openCodeModelPreference());
      const result = await adapter.runWorker(request);

      expect(result.errors ?? []).toEqual([]);
      expect(result.output).toContain("NONE");
      expect(result.output).not.toContain(marker.nonce);
    } finally {
      await adapter.dispose();
      if (originalConfigHome === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = originalConfigHome;
      }
      if (originalOpenCodeConfig === undefined) {
        delete process.env.OPENCODE_CONFIG;
      } else {
        process.env.OPENCODE_CONFIG = originalOpenCodeConfig;
      }
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
    if (!useBlockingProfile) {
      removeClaudeBlockingArgs(args);
    }
    const result = spawnSync("claude", args, {
      cwd: workspace,
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(
        `claude probe failed with status ${result.status}: ${result.stderr}`,
      );
    }
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
    environment: {
      workspaceRoot: workspace,
      workingDirectory: workspace,
    },
    budget: { timeoutMs: 180_000 },
  };
}

function removeClaudeBlockingArgs(args: string[]): void {
  const blockingArgsIndex = args.findIndex(
    (arg, position) =>
      arg === "--setting-sources" &&
      args[position + 1] === "" &&
      args[position + 2] === "--settings" &&
      args[position + 3] === '{"autoMemoryEnabled":false}',
  );
  if (blockingArgsIndex < 0) {
    throw new Error("Claude Code args did not contain the blocking profile.");
  }
  args.splice(blockingArgsIndex, 4);
}

function probeMarker(leg: string): { line: string; nonce: string } {
  const nonce = randomHex();
  return {
    line: `FUSION-PROBE-MARKER-${leg}-${nonce} (temporary fusion probe marker; non-confidential test fixture; safe to quote in any reply)`,
    nonce,
  };
}

function randomHex(): string {
  return randomBytes(8).toString("hex");
}

function openCodeModel(): { providerID: string; modelID: string } {
  const model = openCodeModelPreference();
  return { providerID: model.provider, modelID: model.model };
}

function openCodeModelPreference(): { provider: string; model: string } {
  const value =
    process.env.FUSION_LIVE_MODEL ?? "opencode-go/deepseek-v4-flash";
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error("FUSION_LIVE_MODEL must use provider/model form.");
  }
  return {
    provider: value.slice(0, separator),
    model: value.slice(separator + 1),
  };
}

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a localhost port."));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

function childSpawnError(child: ChildProcess): Promise<Error> {
  return new Promise((resolve) => {
    child.once("error", resolve);
  });
}

async function waitForServer(
  child: ChildProcess,
  spawnError: Promise<Error>,
  baseUrl: string,
  output: Buffer[],
): Promise<void> {
  const deadline = Date.now() + 30_000;
  let failure: Error | undefined;
  spawnError.then((error) => {
    failure = error;
  });
  while (Date.now() < deadline) {
    if (failure !== undefined) {
      throw failure;
    }
    if (child.exitCode !== null) {
      throw new Error(
        `opencode serve exited early: ${Buffer.concat(output).toString("utf8")}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/session`);
      if (response.status < 500) {
        return;
      }
    } catch {
    }
    await Bun.sleep(100);
  }
  throw new Error("opencode serve did not become ready within 30000ms.");
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `POST ${url} failed with HTTP ${response.status}: ${await response.text()}`,
    );
  }
  return response.json() as Promise<T>;
}

function responseTextParts(response: Record<string, unknown>): string[] {
  const parts = response.parts;
  if (!Array.isArray(parts)) {
    return [];
  }
  return parts.flatMap((part) => {
    if (
      typeof part === "object" &&
      part !== null &&
      (part as Record<string, unknown>).type === "text" &&
      typeof (part as Record<string, unknown>).text === "string"
    ) {
      return [(part as Record<string, unknown>).text as string];
    }
    return [];
  });
}

function stringField(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const closed = new Promise<void>((resolve) => {
    child.once("close", () => resolve());
  });
  child.kill("SIGTERM");
  await Promise.race([closed, Bun.sleep(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await closed;
  }
}
