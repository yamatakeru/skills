import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  assertReadRootsCaseSafe,
  findCaseSensitiveReadRootLookup,
  openCodeFoldsPathRuleCase,
  type PathIdentityProbe,
} from "../lib/protocol";

const missing = () =>
  Object.assign(new Error("ENOENT"), { code: "ENOENT" }) as Error;

/**
 * Fake filesystem: `entries` are canonical paths; directories listed in
 * `caseSensitive` look up their children by exact name, all others fold case.
 */
function fakeFs(
  entries: string[],
  caseSensitive: string[] = [],
): PathIdentityProbe & { calls: string[] } {
  const calls: string[] = [];
  const probe = async (path: string) => {
    calls.push(path);
    let current = "";
    for (const name of path.split("/").filter(Boolean)) {
      const parent = current || "/";
      const exact = `${current}/${name}`;
      const folded = caseSensitive.includes(parent)
        ? entries.find((entry) => entry === exact)
        : entries.find(
            (entry) => entry.toLowerCase() === exact.toLowerCase(),
          );
      if (folded === undefined) throw missing();
      current = folded;
    }
    return { dev: 1, ino: entries.indexOf(current) + 1 };
  };
  return Object.assign(probe, { calls });
}

describe("OpenCode read-root case folding (ADR 0055)", () => {
  test.each([
    ["2.4.0", "darwin", true],
    ["2.4.7", "darwin", true],
    ["3.0.0", "darwin", true],
    ["2.3.2", "darwin", false],
    ["2.0.22", "darwin", false],
    ["2.4.0", "linux", false],
    ["2.4.0-beta.1", "darwin", false],
    [undefined, "darwin", false],
  ] as const)("version %s on %s folds path rules: %s", (version, platform, expected) => {
    expect(openCodeFoldsPathRuleCase(version, platform)).toBe(expected);
  });

  test("accepts a root whose every lookup folds case to the same entry", async () => {
    const probe = fakeFs(["/Volumes", "/Volumes/Work", "/Volumes/Work/repo"]);
    expect(
      await findCaseSensitiveReadRootLookup("/Volumes/Work/repo", probe),
    ).toBeUndefined();
  });

  test("flags the final component inside a case-sensitive volume", async () => {
    const probe = fakeFs(
      ["/Volumes", "/Volumes/Work", "/Volumes/Work/repo"],
      ["/Volumes/Work"],
    );
    expect(
      await findCaseSensitiveReadRootLookup("/Volumes/Work/repo", probe),
    ).toBe("/Volumes/Work/repo");
  });

  test("flags a parent component, not only the final one", async () => {
    const probe = fakeFs(
      ["/Volumes", "/Volumes/Data", "/Volumes/Data/Work", "/Volumes/Data/Work/repo"],
      ["/Volumes/Data", "/Volumes/Data/Work"],
    );
    expect(
      await findCaseSensitiveReadRootLookup("/Volumes/Data/Work/repo", probe),
    ).toBe("/Volumes/Data/Work");
  });

  test("flags an existing case-variant sibling that is a different entry", async () => {
    const probe = fakeFs(
      ["/Volumes", "/Volumes/Work", "/Volumes/Work/repo", "/Volumes/Work/REPO"],
      ["/Volumes/Work"],
    );
    expect(
      await findCaseSensitiveReadRootLookup("/Volumes/Work/repo", probe),
    ).toBe("/Volumes/Work/repo");
  });

  test("fails closed when the root cannot be resolved", async () => {
    const probe = fakeFs(["/Volumes"]);
    expect(
      await findCaseSensitiveReadRootLookup("/Volumes/missing", probe),
    ).toBe("/Volumes/missing");
  });

  test("skips components without cased letters", async () => {
    const probe = fakeFs(["/123", "/123/456"], ["/", "/123"]);
    expect(await findCaseSensitiveReadRootLookup("/123/456", probe)).toBeUndefined();
    expect(probe.calls).toEqual([]);
  });

  test("assertion is a no-op where OpenCode does not fold case", async () => {
    const probe = fakeFs([]);
    for (const [version, platform] of [
      ["2.3.2", "darwin"],
      ["2.4.0", "linux"],
    ] as const)
      await assertReadRootsCaseSafe({
        readRoots: ["/nowhere"],
        version,
        platform,
        probe,
      });
    expect(probe.calls).toEqual([]);
  });

  test("assertion names the unsafe root and lookup", async () => {
    const probe = fakeFs(
      ["/Volumes", "/Volumes/Work", "/Volumes/Work/repo"],
      ["/Volumes/Work"],
    );
    await expect(
      assertReadRootsCaseSafe({
        readRoots: ["/Volumes/Work/repo"],
        version: "2.4.0",
        platform: "darwin",
        probe,
      }),
    ).rejects.toThrow(
      /OPENCODE_READ_ROOT_CASE_UNSAFE: .*\/Volumes\/Work\/repo is not verifiably case-insensitive at \/Volumes\/Work\/repo/u,
    );
  });

  test("real temp directory agrees with an independent case probe", async () => {
    const root = await mkdtemp(join(tmpdir(), "fusion-case-root-"));
    try {
      // Mixed-case prefix guarantees a cased component in the created name.
      const folds = existsSync(root.replace(/fusion-case-root-/u, "FUSION-CASE-ROOT-"));
      const lookup = await findCaseSensitiveReadRootLookup(root);
      // The final component folds iff it is not the reported lookup; an
      // ancestor on a case-sensitive volume may still be reported first.
      if (folds) expect(lookup).not.toBe(root);
      else expect(lookup).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
