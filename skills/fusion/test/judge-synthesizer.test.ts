import { describe, expect, test } from "bun:test";
import { renderJudgePrompt } from "../lib/protocol";

describe("Fusion judge synthesizer prompt", () => {
  test("includes an explicit JSON skeleton for attributed contradiction stances", () => {
    const prompt = renderJudgePrompt({
      task: "Compare answers.",
      workerResults: [],
    });

    expect(prompt).toContain('"contradictions": [');
    expect(prompt).toContain('"topic": "..."');
    expect(prompt).toContain('"stances": [');
    expect(prompt).toContain('"stance": "..."');
    expect(prompt).toContain('"workerId": "worker-1"');
    expect(prompt).toContain('"quotes": [');
    expect(prompt).toContain('never invent keys such as "stances_text"');
  });
});
