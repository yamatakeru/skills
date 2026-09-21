import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const skillRoot = join(import.meta.dir, "..");

describe("OpenCode SDK dependency guard", () => {
  test("uses OpenCode packages only through type imports", async () => {
    const files = [
      ...(
        await Bun.$`find ${join(skillRoot, "lib")} ${join(skillRoot, "bin")} -name '*.ts' -type f`.text()
      )
        .split(/\r?\n/u)
        .filter((file) => file.length > 0),
    ].map((file) => relative(skillRoot, file));
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(join(skillRoot, file), "utf8");
      const runtimeImports = source.matchAll(
        /(?:import|export)\s+(?!type\b)[^;]*?from\s+["']@(?:opencode-ai\/sdk|opencode\/[^/"']+)(?:\/[^"']*)?["']|import\s+["']@(?:opencode-ai\/sdk|opencode\/[^/"']+)(?:\/[^"']*)?["']|(?:import|require)\s*\(\s*["']@(?:opencode-ai\/sdk|opencode\/[^/"']+)(?:\/[^"']*)?["']\s*\)/gu,
      );
      for (const match of runtimeImports) {
        violations.push(`${file}: ${match[0].replace(/\s+/gu, " ").trim()}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
