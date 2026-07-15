import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareWorkspace, snapshotWorkspace } from "../lib/protocol";

const scratchDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    scratchDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("workspace watchdog", () => {
  test("reports clean when Git status and refs do not change", async () => {
    const repository = await createRepository();
    const before = await snapshotWorkspace(repository);

    const evidence = await compareWorkspace(before);

    expect(evidence.verdict).toBe("clean");
    expect(evidence.changedPaths).toBeUndefined();
    expect(evidence.refDiffs).toBeUndefined();
  });

  test("reports changed paths without attributing the mutation", async () => {
    const repository = await createRepository();
    const before = await snapshotWorkspace(repository);
    await writeFile(join(repository, "tracked.txt"), "changed\n");

    const evidence = await compareWorkspace(before);

    expect(evidence.verdict).toBe("mutated");
    expect(evidence.changedPaths).toEqual(["tracked.txt"]);
    expect(evidence.note).toBe(
      "workspace mutated during the run; attribution unknown — worker or external process",
    );
  });

  test("reports not-applicable outside a Git work tree", async () => {
    const directory = await createScratchDirectory();

    const evidence = await compareWorkspace(await snapshotWorkspace(directory));

    expect(evidence.verdict).toBe("not-applicable");
    expect(evidence.note).toContain("not observable as a Git work tree");
  });

  test("excludes .fusion-runs paths", async () => {
    const repository = await createRepository();
    const before = await snapshotWorkspace(repository);
    await mkdir(join(repository, ".fusion-runs", "run-1"), {
      recursive: true,
    });
    await writeFile(
      join(repository, ".fusion-runs", "run-1", "events.jsonl"),
      "{}\n",
    );

    const evidence = await compareWorkspace(before);

    expect(evidence.verdict).toBe("clean");
  });

  test("detects local and remote-tracking ref changes", async () => {
    const repository = await createRepository();
    const before = await snapshotWorkspace(repository);
    git(repository, ["branch", "side"]);
    git(repository, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

    const evidence = await compareWorkspace(before);

    expect(evidence.verdict).toBe("mutated");
    expect(evidence.refDiffs?.map((diff) => diff.refName)).toEqual([
      "refs/heads/side",
      "refs/remotes/origin/main",
    ]);
    expect(
      evidence.refDiffs?.find(
        (diff) => diff.refName === "refs/remotes/origin/main",
      )?.after,
    ).toMatch(/^[0-9a-f]{40}$/u);
  });
});

async function createRepository(): Promise<string> {
  const repository = await createScratchDirectory();
  git(repository, ["init", "--quiet"]);
  git(repository, ["config", "user.name", "Fusion Test"]);
  git(repository, ["config", "user.email", "fusion@example.test"]);
  await writeFile(join(repository, "tracked.txt"), "initial\n");
  git(repository, ["add", "tracked.txt"]);
  git(repository, ["commit", "--quiet", "-m", "initial"]);
  return repository;
}

async function createScratchDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "fusion-watchdog-test-"));
  scratchDirectories.push(directory);
  return directory;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
}
