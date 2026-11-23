import { lstat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export type PathIdentity = { dev: number | bigint; ino: number | bigint };
export type PathIdentityProbe = (path: string) => Promise<PathIdentity>;

/**
 * OpenCode 2.4+ matches `read`/`edit`/`external_directory` rules without case
 * on macOS (upstream `Permission.ignoresCase`), so a read-root allow also
 * matches every case variant of the root path (ADR 0055).
 */
export function openCodeFoldsPathRuleCase(
  version: string | undefined,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const match = /^(\d+)\.(\d+)\.\d+$/u.exec(version ?? "");
  if (platform !== "darwin" || match === null) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > 2 || (major === 2 && minor >= 4);
}

function swapCase(value: string): string {
  return [...value]
    .map((char) => {
      const upper = char.toUpperCase();
      return char === upper ? char.toLowerCase() : upper;
    })
    .join("");
}

/**
 * Returns the first path along `root` where a case variant of a component
 * could name a different entry (case-sensitive lookup, or unverifiable), or
 * undefined when every cased component resolves case-insensitively to the same
 * entry. Only lookups, no writes. Paths below the root are already allowed.
 */
export async function findCaseSensitiveReadRootLookup(
  root: string,
  probe: PathIdentityProbe = lstat,
): Promise<string | undefined> {
  let parent: string = sep;
  for (const name of resolve(root).split(sep).filter(Boolean)) {
    const path = join(parent, name);
    const variant = swapCase(name);
    if (variant !== name) {
      try {
        const [actual, folded] = await Promise.all([
          probe(path),
          probe(join(parent, variant)),
        ]);
        if (actual.dev !== folded.dev || actual.ino !== folded.ino) return path;
      } catch {
        return path;
      }
    }
    parent = path;
  }
  return undefined;
}

/** Fails closed before any session when a read root could leak to a case variant. */
export async function assertReadRootsCaseSafe(input: {
  readRoots: readonly string[] | undefined;
  version: string | undefined;
  platform?: NodeJS.Platform;
  probe?: PathIdentityProbe;
}): Promise<void> {
  if (!openCodeFoldsPathRuleCase(input.version, input.platform)) return;
  for (const root of input.readRoots ?? []) {
    const lookup = await findCaseSensitiveReadRootLookup(root, input.probe);
    if (lookup !== undefined)
      throw new Error(
        `OPENCODE_READ_ROOT_CASE_UNSAFE: OpenCode ${input.version} on macOS matches read-root rules without case, but read root ${resolve(root)} is not verifiably case-insensitive at ${lookup} (case-sensitive volume or missing path), so a case variant could name a different directory. Refusing before session creation (ADR 0055). Use a read root on a case-insensitive volume, omit it, or run this panel without OpenCode workers.`,
      );
  }
}
