import { describe, expect, test } from "bun:test";
import {
  JudgeAnalysisValidationError,
  parseJudgeAnalysisOutput,
  validateJudgeAnalysis,
} from "../lib/protocol";
import { okWorkerResult, workerRequest } from "./fixtures";

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
});
