import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { OpenCodeSdkAdapter, defaultPolicies } from "../lib/protocol";
import { workerRequest } from "./fixtures";

const command = Bun.which("opencode");
const version = command
  ? Bun.spawnSync([command, "--version"]).stdout.toString().trim()
  : "";
const supported = /(?:opencode v)?2\.0\.(\d+)$/u.exec(version);

describe("Fusion OpenCode v2 no-model contract", () => {
  test.skipIf(command === null || !supported || Number(supported[1]) < 12)(
    "authenticates, verifies native rules, admits parked input, and interrupts/disposes without a model",
    async () => {
      const workspace = await mkdtemp(
        join(tmpdir(), "fusion-opencode-contract-"),
      );
      const external = await mkdtemp(
        join(tmpdir(), "fusion-opencode-read-root-"),
      );
      let promptCount = 0;
      let baseUrl: string | undefined;
      let sessionId: string | undefined;
      const decisions: Record<string, string> = {};
      const adapter = new OpenCodeSdkAdapter({
        command: command!,
        fetch: async (input, init) => {
          const url = new URL(String(input));
          baseUrl = url.origin;
          if (!url.pathname.endsWith("/prompt")) return fetch(input, init);
          promptCount++;
          sessionId = url.pathname.split("/")[3];
          // The only prompt emitted by this test is durably parked, never run.
          const body = { ...JSON.parse(String(init?.body)), resume: false };
          const admitted = await fetch(input, {
            ...init,
            body: JSON.stringify(body),
          });
          expect(admitted.ok).toBe(true);
          const user = (await admitted.json()) as {
            data: { type: string; id: string };
          };
          expect(user.data.type).toBe("user");
          expect(user.data.id).toBe(body.id);
          for (const [key, action, resource] of [
            ["read", "read", join(workspace, "file.txt")],
            ["shell", "shell", "git status"],
            ["webfetch", "webfetch", "https://example.com"],
            ["websearch", "websearch", "query"],
            ["edit", "edit", join(workspace, "file.txt")],
            ["recursive", "subagent", "general"],
            ["unknown", "future_tool", "*"],
            ["declared", "external_directory", join(external, "file.txt")],
            ["undeclared", "external_directory", "/fusion-undeclared/file.txt"],
          ]) {
            const response = await fetch(
              new URL(`/api/session/${sessionId}/permission`, url),
              {
                ...init,
                body: JSON.stringify({
                  action,
                  resources: [resource],
                  agent: "fusion-worker",
                }),
              },
            );
            expect(response.ok).toBe(true);
            const value = (await response.json()) as {
              data: { effect: string };
            };
            decisions[key!] = value.data.effect;
          }
          const active = (await fetch(new URL("/api/session/active", url), {
            headers: init?.headers,
          }).then((response) => response.json())) as {
            data: Record<string, unknown>;
          };
          expect(active.data).not.toHaveProperty(sessionId!);
          expect((await fetch(new URL("/api/info", url))).status).toBe(401);
          // Stop adapter observation intentionally; finally must still interrupt.
          return new Response(null, { status: 409 });
        },
      });
      try {
        const result = await adapter.runWorker({
          ...workerRequest(),
          environment: { workspaceRoot: workspace, readRoots: [external] },
          toolsPolicy: {
            ...defaultPolicies.tools,
            deny: [...(defaultPolicies.tools.deny ?? []), "Bash", "WebFetch"],
          },
          budget: { timeoutMs: 30_000 },
        });
        expect(promptCount).toBe(1);
        expect(result.status).toBe("error");
        expect(result.errors?.join()).toContain("HTTP 409");
        expect(result.sessionId).toBe(sessionId);
        expect(result.harnessUsed?.version).toBe(
          version.replace(/^opencode v/u, ""),
        );
        expect(result.complianceEvidence?.enforcement?.source).toBe(
          "verified-effective",
        );
        expect(result.complianceEvidence?.enforcement?.abortOutcome).toEqual({
          attempted: true,
          succeeded: true,
        });
        expect(decisions).toEqual({
          read: "allow",
          shell: "deny",
          webfetch: "deny",
          websearch: "allow",
          edit: "deny",
          recursive: "deny",
          unknown: "deny",
          declared: "allow",
          undeclared: "deny",
        });
      } finally {
        await adapter.dispose();
        await rm(workspace, { recursive: true, force: true });
        await rm(external, { recursive: true, force: true });
      }
      expect(baseUrl).toBeDefined();
      await expect(
        fetch(new URL("/api/info", baseUrl!), {
          signal: AbortSignal.timeout(1000),
        }),
      ).rejects.toThrow();
    },
    45_000,
  );
});
