import type { Synthesizer, SynthesisInput, SynthesisResult } from "./types";

export class DeterministicSynthesizer implements Synthesizer {
  async synthesize(input: SynthesisInput): Promise<SynthesisResult> {
    const okResults = input.workerResults.filter(
      (result) => result.status === "ok",
    );
    const failedResults = input.workerResults.filter(
      (result) => result.status !== "ok",
    );
    const synthesis = [
      "# Fusion Synthesis",
      "",
      "## Consensus",
      okResults.length === 0
        ? "No workers returned an ok result."
        : "Deterministic synthesis preserves each successful worker output for review.",
      "",
      "## Worker Outputs",
      ...okResults.flatMap((result) => [
        `### ${result.workerId}`,
        result.output.trim() || "[empty output]",
        "",
      ]),
      "## Failed Or Incomplete Workers",
      failedResults.length === 0
        ? "None."
        : failedResults
            .map((result) => `- ${result.workerId}: ${result.status}`)
            .join("\n"),
      "",
      "## Blind Spots",
      "This deterministic fallback does not infer unstated agreement or resolve contradictions beyond preserving worker outputs.",
    ].join("\n");

    return {
      strategy: "deterministic",
      synthesis,
      finalAnswer: synthesis,
      warnings: [
        "Deterministic synthesizer is a fallback for testability, not the final answer-quality target.",
      ],
    };
  }
}

export const deterministicSynthesizer = new DeterministicSynthesizer();
