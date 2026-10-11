import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeCommand,
  spawnProcessGroup,
  terminateActiveProcessGroups,
  terminateProcessGroup,
} from "../lib/protocol";

// Real processes: each test uses a unique sleep duration as a pgrep marker.
const posixOnly = process.platform === "win32" ? test.skip : test;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await terminateActiveProcessGroups();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function running(marker: string): boolean {
  return Bun.spawnSync(["pgrep", "-f", marker]).exitCode === 0;
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await Bun.sleep(20);
  }
}

describe("Fusion process groups", () => {
  posixOnly(
    "a timeout returns promptly and reaps a descendant holding stdout",
    async () => {
      const startedAt = Date.now();
      const result = await executeCommand({
        command: "sh",
        args: ["-c", "sleep 41.0101 & wait"],
        timeoutMs: 200,
      });

      expect(result.timedOut).toBe(true);
      expect(Date.now() - startedAt).toBeLessThan(5_000);
      expect(running("sleep 41.0101")).toBe(false);
    },
  );

  posixOnly("a normal exit reaps background processes left behind", async () => {
    const result = await executeCommand({
      command: "sh",
      args: ["-c", "sleep 42.0202 >/dev/null 2>&1 & echo done"],
      timeoutMs: 10_000,
    });

    expect(result.timedOut).toBe(false);
    expect(result.stdout.trim()).toBe("done");
    expect(running("sleep 42.0202")).toBe(false);
  });

  posixOnly(
    "signals the leader first and kills the rest of the group after the grace period",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "fusion-pgroup-"));
      temporaryDirectories.push(directory);
      const marker = join(directory, "descendant-saw-sigterm");
      // The descendant records a SIGTERM; it must instead die by SIGKILL.
      const child = spawnProcessGroup(
        "sh",
        [
          "-c",
          `sh -c 'trap "echo term > ${marker}; exit" TERM; sleep 43.0303 & wait' & trap 'exit 0' TERM; wait`,
        ],
        { stdio: "ignore" },
      );
      await waitUntil(() => running("sleep 43.0303"));

      await terminateProcessGroup(child, 300);

      expect(child.exitCode ?? child.signalCode).not.toBeNull();
      expect(running("sleep 43.0303")).toBe(false);
      await expect(readFile(marker, "utf8")).rejects.toThrow();
    },
  );

  posixOnly("escalates to SIGKILL when the leader ignores SIGTERM", async () => {
    const child = spawnProcessGroup(
      "sh",
      ["-c", "trap '' TERM; sleep 44.0404 & wait"],
      { stdio: "ignore" },
    );
    await waitUntil(() => running("sleep 44.0404"));

    await terminateProcessGroup(child, 200);

    expect(running("sleep 44.0404")).toBe(false);
  });

  posixOnly("runtime cleanup stops every group still running", async () => {
    spawnProcessGroup("sh", ["-c", "sleep 45.0505 & wait"], { stdio: "ignore" });
    await waitUntil(() => running("sleep 45.0505"));

    await terminateActiveProcessGroups();

    expect(running("sleep 45.0505")).toBe(false);
  });
});
