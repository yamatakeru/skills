import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  WorkspaceRefDiff,
  WorkspaceWatchdogEvidence,
} from "./types";

const execFileAsync = promisify(execFile);

export const workspaceWatchdogLimitations = [
  "gitignored areas are not detectable",
  "writes outside the workspace are not detectable",
  "remote API side effects are not detectable",
] as const;

export interface WorkspaceSnapshot {
  workspaceRoot: string;
  applicable: boolean;
  paths: Map<string, string>;
  refs: Map<string, string>;
  error?: string;
}

export async function snapshotWorkspace(
  workspaceRoot: string,
): Promise<WorkspaceSnapshot> {
  try {
    const inside = await runGit(workspaceRoot, [
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    if (inside.trim() !== "true") {
      return notApplicableSnapshot(workspaceRoot);
    }
    const [status, refs] = await Promise.all([
      runGit(workspaceRoot, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]),
      runGit(workspaceRoot, [
        "for-each-ref",
        "--format=%(refname)%09%(objectname)",
      ]),
    ]);
    return {
      workspaceRoot,
      applicable: true,
      paths: parsePorcelainStatus(status),
      refs: parseRefs(refs),
    };
  } catch (error) {
    return notApplicableSnapshot(workspaceRoot, errorMessage(error));
  }
}

export async function compareWorkspace(
  before: WorkspaceSnapshot,
): Promise<WorkspaceWatchdogEvidence> {
  if (!before.applicable) {
    return watchdogEvidence({
      verdict: "not-applicable",
      workspaceRoot: before.workspaceRoot,
      note: before.error === undefined
        ? "workspace is not a Git work tree"
        : `workspace is not observable as a Git work tree: ${before.error}`,
    });
  }

  let after: WorkspaceSnapshot;
  try {
    after = await snapshotWorkspace(before.workspaceRoot);
  } catch (error) {
    return watchdogEvidence({
      verdict: "mutated",
      workspaceRoot: before.workspaceRoot,
      note: `workspace mutated during the run; attribution unknown — worker or external process; final Git snapshot failed: ${errorMessage(error)}`,
    });
  }
  if (!after.applicable) {
    return watchdogEvidence({
      verdict: "mutated",
      workspaceRoot: before.workspaceRoot,
      note: "workspace mutated during the run; attribution unknown — worker or external process; final Git snapshot was not applicable",
    });
  }

  const changedPaths = changedMapKeys(before.paths, after.paths);
  const refDiffs = diffRefs(before.refs, after.refs);
  const mutated = changedPaths.length > 0 || refDiffs.length > 0;
  return mutated
    ? watchdogEvidence({
        verdict: "mutated",
        workspaceRoot: before.workspaceRoot,
        changedPaths: changedPaths.length > 0 ? changedPaths : undefined,
        refDiffs: refDiffs.length > 0 ? refDiffs : undefined,
        note: "workspace mutated during the run; attribution unknown — worker or external process",
      })
    : watchdogEvidence({
        verdict: "clean",
        workspaceRoot: before.workspaceRoot,
        note: "no workspace mutation was observed during the run",
      });
}

export function notApplicableWatchdogEvidence(
  workspaceRoot: string,
): WorkspaceWatchdogEvidence {
  return watchdogEvidence({
    verdict: "not-applicable",
    workspaceRoot,
    note: "workspace watchdog evidence was not provided",
  });
}

function watchdogEvidence(
  input:
    | {
        verdict: "clean";
        workspaceRoot: string;
        note: string;
        changedPaths?: never;
        refDiffs?: never;
      }
    | {
        verdict: "not-applicable";
        workspaceRoot: string;
        note: string;
        changedPaths?: never;
        refDiffs?: never;
      }
    | {
        verdict: "mutated";
        workspaceRoot: string;
        note: string;
        changedPaths?: string[];
        refDiffs?: WorkspaceRefDiff[];
      },
): WorkspaceWatchdogEvidence {
  return {
    ...input,
    limitations: [...workspaceWatchdogLimitations],
  };
}

async function runGit(workspaceRoot: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", workspaceRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return result.stdout;
}

function parsePorcelainStatus(output: string): Map<string, string> {
  const paths = new Map<string, string>();
  const records = output.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined || record.length < 4) {
      continue;
    }
    const status = record.slice(0, 2);
    const path = record.slice(3);
    if (!isFusionRunPath(path)) {
      paths.set(path, status);
    }
    if (status.includes("R") || status.includes("C")) {
      const originalPath = records[index + 1];
      index += 1;
      if (originalPath !== undefined && !isFusionRunPath(originalPath)) {
        paths.set(originalPath, `${status} (source)`);
      }
    }
  }
  return paths;
}

function parseRefs(output: string): Map<string, string> {
  const refs = new Map<string, string>();
  for (const line of output.split(/\r?\n/u)) {
    const separator = line.indexOf("\t");
    if (separator > 0) {
      refs.set(line.slice(0, separator), line.slice(separator + 1));
    }
  }
  return refs;
}

function changedMapKeys(
  before: Map<string, string>,
  after: Map<string, string>,
): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((key) => before.get(key) !== after.get(key))
    .sort();
}

function diffRefs(
  before: Map<string, string>,
  after: Map<string, string>,
): WorkspaceRefDiff[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((refName) => before.get(refName) !== after.get(refName))
    .sort()
    .map((refName) => ({
      refName,
      before: before.get(refName),
      after: after.get(refName),
    }));
}

function isFusionRunPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//u, "");
  return normalized === ".fusion-runs" || normalized.startsWith(".fusion-runs/");
}

function notApplicableSnapshot(
  workspaceRoot: string,
  error?: string,
): WorkspaceSnapshot {
  return {
    workspaceRoot,
    applicable: false,
    paths: new Map(),
    refs: new Map(),
    error,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
