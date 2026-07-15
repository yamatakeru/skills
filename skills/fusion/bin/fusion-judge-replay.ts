#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import {
  AdapterRegistry,
  ClaudeCodeSdkAdapter,
  CursorSdkAdapter,
  HarnessBackedJudgeSynthesizer,
  OpenCodeSdkAdapter,
  assertTopLevelFusionInvocation,
  errorMessage,
  resolveModelEntry,
  type HarnessKind,
  type WorkerRunner,
} from "../lib/protocol";
import {
  assertReplayArtifactsAvailable,
  buildReplayInput,
  loadRecordedRun,
  resolveRecordedRunDir,
  writeReplayArtifacts,
  type ReplayArtifactPaths,
} from "../lib/judge-replay";

export interface JudgeReplayCliOptions {
  run: string;
  arm: string;
  tools: "none" | "worker-parity";
  groundingFile?: string;
  judgeModel: string;
  timeoutMs: number;
  json: boolean;
  force: boolean;
}

export class JudgeReplayUsageError extends Error {}
export class JudgeReplayHelpRequested extends Error {}

export interface JudgeReplayReport {
  arm: string;
  panelRunId: string;
  judge: { modelEntry: string; harness: HarnessKind };
  toolsMode: "none" | "worker-parity";
  validationStatus: "passed" | "fallback";
  artifacts: ReplayArtifactPaths;
  warnings: string[];
}

async function main(): Promise<number> {
  let runtime: ReplayRuntime | undefined;
  try {
    assertTopLevelFusionInvocation();
    assertBunRuntime();
    const options = parseJudgeReplayArgs(Bun.argv.slice(2));
    const cwd = process.cwd();
    const runDir = resolveRecordedRunDir(options.run, cwd);
    const recorded = await loadRecordedRun(runDir);
    if (!options.force) {
      await assertReplayArtifactsAvailable(recorded.runDir, options.arm);
    }
    const resolvedModel = await resolveModelEntry(options.judgeModel, { cwd });
    const groundingAppendix =
      options.groundingFile === undefined
        ? undefined
        : await readFile(options.groundingFile, "utf8");
    const warnings: string[] = [];
    if (groundingAppendix !== undefined && options.tools === "worker-parity") {
      warnings.push(
        "Grounding appendix and worker-parity tools are both enabled; fetched and pre-fetched evidence may overlap.",
      );
    }
    const replay = buildReplayInput(recorded, {
      judgeModel: resolvedModel.modelPreference,
      judgeHarness: resolvedModel.harness,
      toolsMode: options.tools,
      groundingAppendix,
      timeoutMs: options.timeoutMs,
    });
    runtime = createReplayRuntime();
    const synthesizer = new HarnessBackedJudgeSynthesizer({
      runner: runtime.registry,
      harnessSelector: runtime.registry,
      judgeToolsPolicy: replay.judgeToolsPolicy,
      judgePromptExtras: replay.judgePromptExtras,
    });
    const result = await synthesizer.synthesize(replay.synthesisInput);
    const artifacts = await writeReplayArtifacts(
      recorded.runDir,
      options.arm,
      result,
      {
        armId: options.arm,
        judgeModelEntry: options.judgeModel,
        judgeHarness: resolvedModel.harness,
        toolsPolicyMode: options.tools,
        toolsConstraintPresent: options.tools === "worker-parity",
        groundingPresent: groundingAppendix !== undefined,
        groundingAppendix,
        timeoutMs: options.timeoutMs,
        force: options.force,
      },
    );
    const report: JudgeReplayReport = {
      arm: options.arm,
      panelRunId: recorded.panelRequest.panelRunId,
      judge: {
        modelEntry: options.judgeModel,
        harness: resolvedModel.harness,
      },
      toolsMode: options.tools,
      validationStatus:
        result.analysis !== undefined && result.fallbackReason === undefined
          ? "passed"
          : "fallback",
      artifacts,
      warnings,
    };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(renderJudgeReplayReport(report));
    }
    return report.validationStatus === "passed" ? 0 : 1;
  } catch (error) {
    if (error instanceof JudgeReplayHelpRequested) {
      process.stdout.write(`${judgeReplayUsage()}\n`);
      return 0;
    }
    process.stderr.write(`${errorMessage(error)}\n`);
    if (error instanceof JudgeReplayUsageError) {
      process.stderr.write(`\n${judgeReplayUsage()}\n`);
    }
    return 1;
  } finally {
    try {
      await runtime?.dispose();
    } catch (error) {
      process.stderr.write(
        `Warning: failed to dispose Fusion replay runtime: ${errorMessage(error)}\n`,
      );
    }
  }
}

export function parseJudgeReplayArgs(args: string[]): JudgeReplayCliOptions {
  const values: Partial<JudgeReplayCliOptions> = {
    tools: "none",
    timeoutMs: 600_000,
    json: false,
    force: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      throw new JudgeReplayUsageError(
        `Unexpected positional argument: ${arg}`,
      );
    }
    const [flag, inlineValue] = splitFlag(arg);
    const takeValue = (): string => {
      if (inlineValue !== undefined) {
        if (inlineValue.length === 0) {
          throw new JudgeReplayUsageError(`${flag} requires a value.`);
        }
        return inlineValue;
      }
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new JudgeReplayUsageError(`${flag} requires a value.`);
      }
      index += 1;
      return value;
    };
    const rejectValue = (): void => {
      if (inlineValue !== undefined) {
        throw new JudgeReplayUsageError(`${flag} does not take a value.`);
      }
    };

    switch (flag) {
      case "--run":
        values.run = takeValue();
        break;
      case "--arm":
        values.arm = takeValue();
        break;
      case "--tools": {
        const tools = takeValue();
        if (tools !== "none" && tools !== "worker-parity") {
          throw new JudgeReplayUsageError(
            "--tools must be one of: none, worker-parity.",
          );
        }
        values.tools = tools;
        break;
      }
      case "--grounding-file":
        values.groundingFile = takeValue();
        break;
      case "--judge-model":
        values.judgeModel = takeValue();
        break;
      case "--timeout-ms":
        values.timeoutMs = parsePositiveInteger(flag, takeValue());
        break;
      case "--json":
        rejectValue();
        values.json = true;
        break;
      case "--force":
        rejectValue();
        values.force = true;
        break;
      case "--help":
        rejectValue();
        throw new JudgeReplayHelpRequested();
      default:
        throw new JudgeReplayUsageError(
          `Unknown Fusion judge replay option: ${flag}`,
        );
    }
  }

  if (values.run === undefined) {
    throw new JudgeReplayUsageError("--run is required.");
  }
  if (values.arm === undefined) {
    throw new JudgeReplayUsageError("--arm is required.");
  }
  if (!/^[A-Za-z0-9._-]+$/u.test(values.arm)) {
    throw new JudgeReplayUsageError(
      "--arm must contain only letters, numbers, dots, underscores, or hyphens.",
    );
  }
  if (values.judgeModel === undefined) {
    throw new JudgeReplayUsageError("--judge-model is required.");
  }
  return values as JudgeReplayCliOptions;
}

export function renderJudgeReplayReport(report: JudgeReplayReport): string {
  const lines = [
    "# Fusion Judge Replay",
    "",
    `- Arm: ${report.arm}`,
    `- Panel run id: ${report.panelRunId}`,
    `- Judge: ${report.judge.modelEntry} via ${report.judge.harness}`,
    `- Tools mode: ${report.toolsMode}`,
    `- Validation status: ${report.validationStatus}`,
    `- Synthesis artifact: ${report.artifacts.synthesis}`,
    `- Manifest artifact: ${report.artifacts.manifest}`,
    `- Warnings: ${report.warnings.length === 0 ? "none" : report.warnings.join("; ")}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export function judgeReplayUsage(): string {
  return [
    "Usage: bun skills/fusion/bin/fusion-judge-replay.ts --run <id-or-path> --arm <id> --judge-model <entry> [options]",
    "",
    "Options:",
    "  --run <id-or-path>       Recorded panel run id or directory path.",
    "  --arm <id>               Experiment arm label used in artifact names.",
    "  --tools <mode>           none or worker-parity (default: none).",
    "  --grounding-file <path>  Append pre-fetched untrusted source material.",
    "  --judge-model <entry>    Required judge model entry.",
    "  --timeout-ms <n>         Judge timeout in milliseconds (default: 600000).",
    "  --json                    Print a structured replay report.",
    "  --force                   Overwrite existing artifacts for this arm.",
    "  --help                    Show this help.",
  ].join("\n");
}

interface ReplayRuntime {
  registry: AdapterRegistry;
  dispose(): Promise<void>;
}

function createReplayRuntime(): ReplayRuntime {
  const opencode = new OpenCodeSdkAdapter();
  const claudeCode = new ClaudeCodeSdkAdapter();
  const cursor = new CursorSdkAdapter();
  const registry = new AdapterRegistry()
    .register("opencode", opencode)
    .register("claude-code", claudeCode)
    .register("cursor", cursor);
  return {
    registry,
    async dispose() {
      for (const runner of [opencode, claudeCode, cursor]) {
        await (
          runner as WorkerRunner & { dispose?: () => Promise<void> | void }
        ).dispose?.();
      }
    },
  };
}

function splitFlag(arg: string): [string, string | undefined] {
  const equalsIndex = arg.indexOf("=");
  return equalsIndex === -1
    ? [arg, undefined]
    : [arg.slice(0, equalsIndex), arg.slice(equalsIndex + 1)];
}

function parsePositiveInteger(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new JudgeReplayUsageError(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function assertBunRuntime(): void {
  if (typeof Bun === "undefined") {
    throw new JudgeReplayUsageError("Fusion judge replay requires Bun.");
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
