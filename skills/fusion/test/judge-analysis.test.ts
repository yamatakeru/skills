import { describe, expect, test } from "bun:test";
import {
  JudgeAnalysisValidationError,
  parseJudgeAnalysisOutput,
  validateJudgeAnalysis,
} from "../lib/protocol";
import {
  judgeAnalysisJson,
  okWorkerResult,
  okWorkerResultWithModel,
  workerRequest,
} from "./fixtures";

describe("Fusion judge analysis validation", () => {
  test("accepts the upstream five-key core shape from a JSON fence", () => {
    const result = parseJudgeAnalysisOutput(
      [
        "```json",
        JSON.stringify({
          consensus: ["same conclusion"],
          contradictions: [
            {
              topic: "approach",
              stances: { "worker-1": "use A", "worker-2": "use B" },
            },
          ],
          partial_coverage: [],
          unique_insights: ["single-worker point"],
          blind_spots: ["missing benchmark"],
        }),
        "```",
      ].join("\n"),
      [],
    );

    expect(result.analysis.consensus).toEqual(["same conclusion"]);
    expect(result.analysis.contradictions[0]?.topic).toBe("approach");
    expect(result.warnings).toEqual([]);
  });

  test("keeps optional quote mismatches as warnings", () => {
    const request = workerRequest();
    const worker = okWorkerResult(request);
    const result = parseJudgeAnalysisOutput(
      JSON.stringify({
        consensus: [
          {
            text: "same conclusion",
            attribution: [{ workerId: "worker-1" }],
            quotes: [{ workerId: "worker-1", quote: "not in output" }],
          },
        ],
        contradictions: [],
        partial_coverage: [],
        unique_insights: [],
        blind_spots: [],
      }),
      [worker],
    );

    expect(result.analysis.consensus[0]).toEqual({
      text: "same conclusion",
      attribution: [{ workerId: "worker-1" }],
      quotes: [{ workerId: "worker-1", quote: "not in output" }],
    });
    expect(result.warnings.join("\n")).toContain("was not found");
  });

  test("rejects non-core top-level fields such as verdicts", () => {
    expect(() =>
      validateJudgeAnalysis({
        consensus: [],
        contradictions: [],
        partial_coverage: [],
        unique_insights: [],
        blind_spots: [],
        verdict: "worker-1 wins",
      }),
    ).toThrow(JudgeAnalysisValidationError);
  });

  test("accepts upstream partial coverage models and point with resolved attribution", () => {
    const result = parseJudgeAnalysisOutput(
      judgeAnalysisJson({
        partial_coverage: [
          {
            models: ["gpt-5.5", "Claude-Sonnet-4"],
            point: "Workers split the coverage.",
          },
        ],
      }),
      [
        okWorkerResultWithModel("worker-1", "openai/gpt-5.5"),
        okWorkerResultWithModel("worker-2", "anthropic/claude-sonnet-4"),
      ],
    );

    expect(result.analysis.partial_coverage).toEqual([
      {
        text: "Workers split the coverage.",
        attribution: [
          { workerId: "worker-1", modelUsed: "openai/gpt-5.5" },
          { workerId: "worker-2", modelUsed: "anthropic/claude-sonnet-4" },
        ],
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  test("accepts upstream unique insight model and insight with resolved attribution", () => {
    const result = parseJudgeAnalysisOutput(
      judgeAnalysisJson({
        unique_insights: [
          {
            model: "OPENAI/GPT-5.5",
            insight: "Worker one noticed a migration edge case.",
          },
        ],
      }),
      [
        okWorkerResultWithModel("worker-1", "openai/gpt-5.5"),
        okWorkerResultWithModel("worker-2", "anthropic/claude-sonnet-4"),
      ],
    );

    expect(result.analysis.unique_insights).toEqual([
      {
        text: "Worker one noticed a migration edge case.",
        attribution: [{ workerId: "worker-1", modelUsed: "openai/gpt-5.5" }],
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  test("accepts upstream contradiction stance model and promotes attribution", () => {
    const result = parseJudgeAnalysisOutput(
      judgeAnalysisJson({
        contradictions: [
          {
            topic: "migration",
            stances: [
              {
                model: "gpt-5.5",
                stance: "Use the compatibility layer first.",
              },
            ],
          },
        ],
      }),
      [okWorkerResultWithModel("worker-1", "openai/gpt-5.5")],
    );

    expect(result.analysis.contradictions[0]?.stances).toEqual([
      {
        stance: "Use the compatibility layer first.",
        attribution: [{ workerId: "worker-1", modelUsed: "openai/gpt-5.5" }],
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  test("keeps upstream finding valid when model attribution is unknown", () => {
    const result = parseJudgeAnalysisOutput(
      judgeAnalysisJson({
        unique_insights: [
          {
            model: "unknown/model",
            insight: "The source model is not in the panel.",
          },
        ],
      }),
      [okWorkerResultWithModel("worker-1", "openai/gpt-5.5")],
    );

    expect(result.analysis.unique_insights).toEqual([
      { text: "The source model is not in the panel." },
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("unknown/model");
    expect(result.warnings[0]).toContain("did not match");
  });

  test("keeps upstream finding unattributed when model name only matches by containment", () => {
    const result = parseJudgeAnalysisOutput(
      judgeAnalysisJson({
        unique_insights: [
          {
            model: "gpt-4",
            insight: "The judge used a shortened model name.",
          },
        ],
      }),
      [okWorkerResultWithModel("worker-1", "openai/gpt-4-turbo")],
    );

    expect(result.analysis.unique_insights).toEqual([
      { text: "The judge used a shortened model name." },
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("gpt-4");
    expect(result.warnings[0]).toContain("did not match");
  });

  test("keeps upstream finding valid when worker results are empty", () => {
    const result = parseJudgeAnalysisOutput(
      judgeAnalysisJson({
        consensus: [],
        unique_insights: [
          {
            model: "openai/gpt-5.5",
            insight: "The source model has no available worker result.",
          },
        ],
      }),
      [],
    );

    expect(result.analysis.unique_insights).toEqual([
      { text: "The source model has no available worker result." },
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("openai/gpt-5.5");
    expect(result.warnings[0]).toContain("did not match");
  });

  test("keeps upstream finding valid when model attribution is ambiguous", () => {
    const result = parseJudgeAnalysisOutput(
      judgeAnalysisJson({
        unique_insights: [
          {
            model: "gpt-5.5",
            insight: "The source model maps to multiple workers.",
          },
        ],
      }),
      [
        okWorkerResultWithModel("worker-1", "openai/gpt-5.5"),
        okWorkerResultWithModel("worker-2", "azure/gpt-5.5"),
      ],
    );

    expect(result.analysis.unique_insights).toEqual([
      { text: "The source model maps to multiple workers." },
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("matched multiple workers");
    expect(result.warnings[0]).toContain("worker-1");
    expect(result.warnings[0]).toContain("worker-2");
  });

  test("rejects unrelated object shapes in finding sections", () => {
    expect(() =>
      validateJudgeAnalysis({
        consensus: [],
        contradictions: [],
        partial_coverage: [{ foo: "bar" }],
        unique_insights: [],
        blind_spots: [],
      }),
    ).toThrow(JudgeAnalysisValidationError);
  });
});
