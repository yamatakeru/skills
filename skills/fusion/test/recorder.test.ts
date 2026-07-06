import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeterministicSynthesizer,
  FileRunRecorder,
  HarnessBackedJudgeSynthesizer,
  NoopRunRecorder,
  runPanel,
} from "../lib/protocol";
import {
  judgeAnalysisJson,
  judgeRunner,
  okRunner,
  panelRequest,
} from "./fixtures";

async function withTempWorkspace(
  options: { prefix: string; gitignore?: string },
  run: (workspaceRoot: string) => Promise<void>,
): Promise<void> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), options.prefix));
  if (options.gitignore !== undefined) {
    await writeFile(join(workspaceRoot, ".gitignore"), options.gitignore);
  }
  try {
    await run(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

describe("Fusion run recorders", () => {
  test("no-op recorder does not record", () => {
    expect(new NoopRunRecorder().status).toBe("not-recorded");
  });

  test("file recorder writes split artifacts with redaction", async () => {
    await withTempWorkspace(
      { prefix: "fusion-recorder-", gitignore: ".fusion-runs/\n" },
      async (workspaceRoot) => {
        const request = panelRequest({ panelRunId: "recorded-run" });
        const recorder = new FileRunRecorder({
          workspaceRoot,
          panelRunId: request.panelRunId,
        });

        await runPanel(request, {
          runner: okRunner(),
          synthesizer: new DeterministicSynthesizer(),
          recorder,
        });

        const runDirectory = join(
          workspaceRoot,
          ".fusion-runs",
          "recorded-run",
        );
        const requestJson = await readFile(
          join(runDirectory, "request.json"),
          "utf8",
        );
        const synthesisJson = await readFile(
          join(runDirectory, "synthesis.json"),
          "utf8",
        );
        const eventsJsonl = await readFile(
          join(runDirectory, "events.jsonl"),
          "utf8",
        );

        expect(recorder.status).toBe("complete");
        expect(requestJson).toContain("[REDACTED]");
        expect(requestJson).not.toContain("do-not-write");
        expect(synthesisJson).toContain("deterministic");
        expect(eventsJsonl).toContain("panel.started");
        const complianceEvent = eventsJsonl
          .split("\n")
          .filter((line) => line.length > 0)
          .map(
            (line) =>
              JSON.parse(line) as { type: string; data?: { tier?: string } },
          )
          .find((event) => event.type === "compliance.evaluated");
        expect(complianceEvent?.data?.tier).toBe("full");
      },
    );
  });

  test("file recorder writes judge request and result in synthesis artifacts", async () => {
    await withTempWorkspace(
      { prefix: "fusion-judge-recorder-", gitignore: ".fusion-runs/\n" },
      async (workspaceRoot) => {
        const request = panelRequest({
          panelRunId: "judge-recorded-run",
          synthesizer: { strategy: "opencode" },
        });
        const recorder = new FileRunRecorder({
          workspaceRoot,
          panelRunId: request.panelRunId,
        });
        const runner = judgeRunner({
          judgeOutput: judgeAnalysisJson({
            consensus: ["Workers agree."],
            contradictions: [],
            partial_coverage: [],
            unique_insights: [],
            blind_spots: [],
          }),
        });

        await runPanel(request, {
          runner,
          synthesizer: new HarnessBackedJudgeSynthesizer({ runner }),
          recorder,
        });

        const synthesisJson = await readFile(
          join(
            workspaceRoot,
            ".fusion-runs",
            "judge-recorded-run",
            "synthesis.json",
          ),
          "utf8",
        );

        expect(synthesisJson).toContain('"analysis"');
        expect(synthesisJson).toContain('"judgeRequest"');
        expect(synthesisJson).toContain('"judgeResult"');
        expect(synthesisJson).toContain('"referenceSynthesis"');
      },
    );
  });

  test("file recorder requires git-ignore safety unless explicitly overridden", async () => {
    await withTempWorkspace(
      { prefix: "fusion-recorder-unsafe-" },
      async (workspaceRoot) => {
        const recorder = new FileRunRecorder({
          workspaceRoot,
          panelRunId: "unsafe-run",
        });

        await expect(recorder.recordRequest(panelRequest())).rejects.toThrow(
          "not git-ignored",
        );
        expect(recorder.status).toBe("failed");
      },
    );
  });

  test("file recorder rejects unsafe panel run ids", () => {
    expect(
      () =>
        new FileRunRecorder({
          workspaceRoot: "/tmp",
          panelRunId: "../escape",
        }),
    ).toThrow("safe path segment");
  });

  test("file recorder requires explicit override for custom root directories", () => {
    expect(
      () =>
        new FileRunRecorder({
          workspaceRoot: "/tmp",
          panelRunId: "safe-run",
          rootDirectory: "/tmp/custom-fusion-runs",
        }),
    ).toThrow("allowUnignoredDirectory");
  });

  test("file recorder redacts common secret string formats", async () => {
    await withTempWorkspace(
      { prefix: "fusion-redaction-", gitignore: ".fusion-runs/\n" },
      async (workspaceRoot) => {
        const request = panelRequest({ panelRunId: "redacted-run" });
        request.sharedContext.text = [
          "Authorization: Bearer bearer-secret-value",
          "OPENAI_API_KEY=sk-1234567890abcdef",
          "GITHUB_TOKEN=ghp_1234567890abcdef",
        ].join("\n");
        const recorder = new FileRunRecorder({
          workspaceRoot,
          panelRunId: request.panelRunId,
        });

        await recorder.recordRequest(request);

        const requestJson = await readFile(
          join(workspaceRoot, ".fusion-runs", "redacted-run", "request.json"),
          "utf8",
        );
        expect(requestJson).not.toContain("bearer-secret-value");
        expect(requestJson).not.toContain("sk-1234567890abcdef");
        expect(requestJson).not.toContain("ghp_1234567890abcdef");
      },
    );
  });
});
