import { describe, expect, spyOn, test } from "bun:test";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeterministicSynthesizer,
  FileRunRecorder,
  HarnessBackedJudgeSynthesizer,
  NoopRunRecorder,
  runPanel,
  type WorkerRequest,
  type WorkerResult,
} from "../lib/protocol";
import {
  judgeAnalysisJson,
  judgeRunner,
  okRunner,
  okWorkerResult,
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

  test("signal handling writes the marker, cleans up, then exits", async () => {
    await withTempWorkspace(
      { prefix: "fusion-recorder-signal-", gitignore: ".fusion-runs/\n" },
      async (workspaceRoot) => {
        const order: string[] = [];
        const existingHandlers = new Set(process.listeners("SIGTERM"));
        const exit = spyOn(process, "exit").mockImplementation((code) => {
          order.push(`exit:${code}`);
          return undefined as never;
        });
        try {
          const recorder = new FileRunRecorder({
            workspaceRoot,
            panelRunId: "signal-run",
            async onSignalCleanup() {
              const marker = JSON.parse(
                await readFile(
                  join(
                    workspaceRoot,
                    ".fusion-runs",
                    "signal-run",
                    "run-status.json",
                  ),
                  "utf8",
                ),
              ) as { status: string };
              order.push(`marker:${marker.status}`);
              order.push("cleanup");
            },
          });
          await recorder.recordRequest(panelRequest());
          const handler = process
            .listeners("SIGTERM")
            .find((candidate) => !existingHandlers.has(candidate));

          await handler?.("SIGTERM");

          expect(order).toEqual([
            "marker:aborted",
            "cleanup",
            "exit:143",
          ]);
        } finally {
          exit.mockRestore();
        }
      },
    );
  });

  test("signal cleanup timeout still exits", async () => {
    await withTempWorkspace(
      { prefix: "fusion-recorder-timeout-", gitignore: ".fusion-runs/\n" },
      async (workspaceRoot) => {
        const exitCodes: Array<string | number | null | undefined> = [];
        const existingHandlers = new Set(process.listeners("SIGTERM"));
        const exit = spyOn(process, "exit").mockImplementation((code) => {
          exitCodes.push(code);
          return undefined as never;
        });
        try {
          const recorder = new FileRunRecorder({
            workspaceRoot,
            panelRunId: "signal-timeout-run",
            onSignalCleanup: () => new Promise<void>(() => undefined),
            signalCleanupTimeoutMs: 10,
          });
          await recorder.recordRequest(panelRequest());
          const handler = process
            .listeners("SIGTERM")
            .find((candidate) => !existingHandlers.has(candidate));

          await handler?.("SIGTERM");

          expect(exitCodes).toEqual([143]);
        } finally {
          exit.mockRestore();
        }
      },
    );
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
        const runStatus = JSON.parse(
          await readFile(join(runDirectory, "run-status.json"), "utf8"),
        ) as Record<string, string>;

        expect(recorder.status).toBe("complete");
        expect(runStatus.status).toBe("complete");
        expect(runStatus.startedAt).toBeString();
        expect(runStatus.endedAt).toBeString();
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

  test("file recorder resolves the marker to failed for a failed run", async () => {
    await withTempWorkspace(
      { prefix: "fusion-failed-recorder-", gitignore: ".fusion-runs/\n" },
      async (workspaceRoot) => {
        const request = panelRequest({ panelRunId: "failed-run" });
        const recorder = new FileRunRecorder({
          workspaceRoot,
          panelRunId: request.panelRunId,
        });

        const result = await runPanel(request, {
          runner: {
            async runWorker() {
              throw new Error("worker failed");
            },
          },
          synthesizer: new DeterministicSynthesizer(),
          recorder,
        });

        const runStatus = JSON.parse(
          await readFile(
            join(
              workspaceRoot,
              ".fusion-runs",
              request.panelRunId,
              "run-status.json",
            ),
            "utf8",
          ),
        ) as Record<string, string>;
        expect(result.status).toBe("failed");
        expect(recorder.status).toBe("failed");
        expect(runStatus.status).toBe("failed");
        expect(runStatus.startedAt).toBeString();
        expect(runStatus.endedAt).toBeString();
      },
    );
  });

  test("file recorder persists completed workers while the run is still active", async () => {
    await withTempWorkspace(
      { prefix: "fusion-incremental-recorder-", gitignore: ".fusion-runs/\n" },
      async (workspaceRoot) => {
        const request = panelRequest({ panelRunId: "incremental-run" });
        const firstWorker = deferred<WorkerResult>();
        const secondWorker = deferred<WorkerResult>();
        const bothInvoked = deferred<void>();
        const firstPersisted = deferred<void>();
        const requests = new Map<string, WorkerRequest>();
        class ObservedFileRunRecorder extends FileRunRecorder {
          override async recordWorkerResults(
            results: WorkerResult[],
          ): Promise<void> {
            await super.recordWorkerResults(results);
            if (results.length === 1) {
              firstPersisted.resolve();
            }
          }
        }
        const recorder = new ObservedFileRunRecorder({
          workspaceRoot,
          panelRunId: request.panelRunId,
        });
        const panelPromise = runPanel(request, {
          runner: {
            async runWorker(workerRequest) {
              requests.set(workerRequest.workerId, workerRequest);
              if (requests.size === 2) {
                bothInvoked.resolve();
              }
              return workerRequest.workerId === "worker-1"
                ? firstWorker.promise
                : secondWorker.promise;
            },
          },
          synthesizer: new DeterministicSynthesizer(),
          recorder,
        });

        await bothInvoked.promise;
        firstWorker.resolve(okWorkerResult(requests.get("worker-1")!));
        await firstPersisted.promise;

        const runDirectory = join(
          workspaceRoot,
          ".fusion-runs",
          request.panelRunId,
        );
        const partialResults = JSON.parse(
          await readFile(join(runDirectory, "worker-results.json"), "utf8"),
        ) as WorkerResult[];
        const runningStatus = JSON.parse(
          await readFile(join(runDirectory, "run-status.json"), "utf8"),
        ) as Record<string, string>;
        expect(partialResults.map((result) => result.workerId)).toEqual([
          "worker-1",
        ]);
        expect(runningStatus.status).toBe("running");
        expect(runningStatus.startedAt).toBeString();
        expect(runningStatus.endedAt).toBeUndefined();
        await expect(
          access(join(runDirectory, "synthesis.json")),
        ).rejects.toThrow();

        secondWorker.resolve(okWorkerResult(requests.get("worker-2")!));
        await panelPromise;
        const finalResults = JSON.parse(
          await readFile(join(runDirectory, "worker-results.json"), "utf8"),
        ) as WorkerResult[];
        expect(finalResults.map((result) => result.workerId)).toEqual([
          "worker-1",
          "worker-2",
        ]);
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

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
