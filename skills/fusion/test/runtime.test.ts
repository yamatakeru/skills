import { describe, expect, test } from "bun:test";
import {
  DeterministicSynthesizer,
  HarnessBackedJudgeSynthesizer,
  runPanel,
} from "../lib/protocol";
import {
  judgeAnalysisJson,
  judgeRunner,
  mixedRunner,
  okRunner,
  panelRequest,
} from "./fixtures";

describe("Fusion panel runtime", () => {
  test("runs workers, records required events, and uses deterministic synthesis", async () => {
    const result = await runPanel(panelRequest(), {
      runner: okRunner(),
      synthesizer: new DeterministicSynthesizer(),
    });

    expect(result.status).toBe("ok");
    expect(result.synthesis).toContain("# Fusion Synthesis");
    expect(result.synthesis).toContain("worker-1 output");
    expect(result.complianceSummary.tier).toBe("full");
    expect(result.events?.map((event) => event.type)).toContain(
      "compliance.evaluated",
    );
  });

  test("parent-agent strategy keeps synthesis but unsets the final answer", async () => {
    const result = await runPanel(
      { ...panelRequest(), synthesizer: { strategy: "parent-agent" } },
      {
        runner: okRunner(),
        synthesizer: new DeterministicSynthesizer(),
      },
    );

    expect(result.synthesis).toContain("# Fusion Synthesis");
    expect(result.strategy).toBe("parent-agent");
    expect(result.finalAnswer).toBeUndefined();
  });

  test("runs a harness-backed judge through the worker adapter path", async () => {
    const runner = judgeRunner({
      judgeOutput: judgeAnalysisJson(),
    });
    const request = {
      ...panelRequest({
        synthesizer: {
          strategy: "opencode",
          model: { provider: "openai", model: "gpt-5.5" },
        },
      }),
      reasoning: { effort: "high" as const, maxTokens: 2000 },
      workerBudget: { timeoutMs: 1234 },
    };

    const result = await runPanel(request, {
      runner,
      synthesizer: new HarnessBackedJudgeSynthesizer({ runner }),
    });
    const judgeRequest = runner.requests.find(
      (candidate) => candidate.workerId === "judge",
    );

    expect(result.status).toBe("ok");
    expect(result.analysis?.consensus[0]).toEqual({
      text: "Workers agree on the core answer.",
      attribution: [{ workerId: "worker-1" }],
      quotes: [{ workerId: "worker-1", quote: "worker-1 output" }],
    });
    expect(result.synthesis).toContain("# Fusion Judge Analysis");
    expect(result.strategy).toBe("opencode");
    expect(result.finalAnswer).toBeUndefined();
    expect(judgeRequest?.prompt).toContain("worker-1 output");
    expect(judgeRequest?.blindnessPolicy.noPeerOutputs).toBe(false);
    expect(judgeRequest?.toolsPolicy?.mode).toBe("none");
    expect(judgeRequest?.workerPolicy.denyPanelSpawning).toBe(true);
    expect(judgeRequest?.reasoning).toEqual({
      effort: "high",
      maxTokens: 2000,
    });
    expect(judgeRequest?.budget).toEqual({ timeoutMs: 1234 });
    expect(result.complianceSummary.judgeCompliance).toMatchObject({
      workerId: "judge",
      status: "ok",
      modelUsed: "openai/gpt-5.5",
      toolsPolicy: { mode: "none" },
    });
    expect(
      result.events?.find((event) => event.type === "synthesis.completed")
        ?.data,
    ).toMatchObject({
      analysisPresent: true,
      judge: {
        workerId: "judge",
        status: "ok",
        modelUsed: "openai/gpt-5.5",
      },
    });
  });

  test("falls back to parent-agent synthesis when judge output is invalid", async () => {
    const runner = judgeRunner({
      judgeOutput: JSON.stringify({ consensus: [] }),
    });

    const result = await runPanel(
      panelRequest({ synthesizer: { strategy: "opencode" } }),
      {
        runner,
        synthesizer: new HarnessBackedJudgeSynthesizer({ runner }),
      },
    );

    expect(result.status).toBe("ok");
    expect(result.analysis).toBeUndefined();
    expect(result.synthesis).toContain("# Fusion Synthesis");
    expect(result.strategy).toBe("parent-agent");
    expect(result.fallbackReason).toContain("missing keys");
    expect(result.finalAnswer).toBeUndefined();
    expect(result.errors).toBeUndefined();
    expect(result.warnings?.join("\n")).toContain("Judge synthesis failed");
    expect(result.complianceSummary.judgeCompliance?.status).toBe("ok");
  });

  test("falls back to parent-agent synthesis when judge invocation throws", async () => {
    const runner = judgeRunner({
      judgeError: new Error("judge exploded"),
    });

    const result = await runPanel(
      panelRequest({ synthesizer: { strategy: "opencode" } }),
      {
        runner,
        synthesizer: new HarnessBackedJudgeSynthesizer({ runner }),
      },
    );

    expect(result.status).toBe("ok");
    expect(result.analysis).toBeUndefined();
    expect(result.finalAnswer).toBeUndefined();
    expect(result.warnings?.join("\n")).toContain("judge exploded");
    expect(result.complianceSummary.judgeCompliance?.workerId).toBe("judge");
    expect(result.complianceSummary.judgeCompliance?.status).toBeUndefined();
  });

  test("downgrades resumed sessions without clean lineage evidence", async () => {
    const result = await runPanel(panelRequest(), {
      runner: okRunner({ sessionMode: "resume" }),
      synthesizer: new DeterministicSynthesizer(),
      defaults: { session: { mode: "resume", reusePolicy: "none" } },
    });

    expect(result.complianceSummary.tier).toBe("degraded");
    expect(
      result.complianceSummary.workerCompliance[0]?.compliance.degradedReason,
    ).toContain("resumed session clean lineage not proven");
  });

  test("skips synthesis when partial synthesis is disabled and a worker fails", async () => {
    const result = await runPanel(
      panelRequest({ synthesisAllowPartial: false }),
      {
        runner: mixedRunner(),
        synthesizer: new DeterministicSynthesizer(),
      },
    );

    expect(result.status).toBe("failed");
    expect(result.synthesis).toBe("");
    expect(result.errors?.[0]).toContain("partial synthesis is disabled");
  });
});
