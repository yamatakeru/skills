import { describe, expect, test } from "bun:test";
import {
  createContextManifest,
  defaultPolicies,
  renderWorkerPrompt,
  stableDigest,
} from "../lib/protocol";

describe("Fusion context manifests", () => {
  test("are stable for equivalent shared context key ordering", () => {
    const left = createContextManifest({
      renderedPrompt: "review this",
      sharedContext: {
        text: "context",
        files: [{ path: "a.ts", content: "export const a = 1;" }],
      },
    });
    const right = createContextManifest({
      renderedPrompt: "review this",
      sharedContext: {
        files: [{ content: "export const a = 1;", path: "a.ts" }],
        text: "context",
      },
    });

    expect(right).toEqual(left);
  });

  test("hash rendered prompts and digest embedded context files", () => {
    const sharedContext = {
      text: "context",
      files: [{ path: "a.ts", content: "export const a = 1;" }],
    };
    const renderedPrompt = renderWorkerPrompt({
      task: "review this",
      outputContract: defaultPolicies.output,
      sharedContext,
    });
    const manifest = createContextManifest({
      renderedPrompt,
      userTask: "review this",
      sharedContext,
    });

    expect(manifest.renderedPromptHash).toBe(stableDigest(renderedPrompt));
    expect(manifest.userTaskHash).toBe(stableDigest("review this"));
    expect(manifest.files).toEqual([
      { path: "a.ts", digest: stableDigest("export const a = 1;") },
    ]);
  });
});
