import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("OpenCode SDK dependency guard", () => {
  test("uses @opencode-ai/sdk only through type imports", async () => {
    const files = [
      ...(await Bun.$`find skills/fusion/lib skills/fusion/bin -name '*.ts' -type f`.text())
        .split(/\r?\n/u)
        .filter((file) => file.length > 0),
    ];
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(join(process.cwd(), file), "utf8");
      const runtimeImports = source.matchAll(
        /import\s+(?!type\b)[^;]*?from\s+["']@opencode-ai\/sdk(?:\/[^"']*)?["']|import\s+["']@opencode-ai\/sdk(?:\/[^"']*)?["']/gu,
      );
      for (const match of runtimeImports) {
        violations.push(`${file}: ${match[0].replace(/\s+/gu, " ").trim()}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
