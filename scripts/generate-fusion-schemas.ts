// Regenerates the JSON Schemas exported from the Fusion contract types.
// Invoked via `bun run schema:fusion`; regeneration must stay idempotent.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const schemaDirectory = "skills/fusion/schema";
const typesPath = "skills/fusion/lib/types.ts";
const schemaTypes = [
  { type: "PanelRequest", out: "panel-request.schema.json" },
  { type: "WorkerRequest", out: "worker-request.schema.json" },
  { type: "WorkerResult", out: "worker-result.schema.json" },
  { type: "JudgeAnalysis", out: "judge-analysis.schema.json" },
  { type: "SynthesisResult", out: "synthesis-result.schema.json" },
  { type: "PanelResult", out: "panel-result.schema.json" },
  { type: "DryRunReport", out: "dry-run-report.schema.json" },
];

mkdirSync(schemaDirectory, { recursive: true });
for (const { type, out } of schemaTypes) {
  const result = spawnSync(
    "bunx",
    [
      "ts-json-schema-generator",
      "--path",
      typesPath,
      "--type",
      type,
      "--tsconfig",
      "tsconfig.json",
      "--out",
      `${schemaDirectory}/${out}`,
    ],
    { stdio: "inherit" },
  );
  // A spawn failure (e.g. missing bunx) sets result.error and never runs the
  // child, so inherited stdio prints nothing; surface it distinctly.
  if (result.error !== undefined) {
    console.error(`Failed to spawn schema generation for ${type}:`, result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
