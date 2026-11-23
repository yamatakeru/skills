import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SUPPORTED_OPENCODE_VERSIONS } from "../lib/opencode-sdk-adapter";

// SKILL.md and details/ are read by calling agents from an installed skill
// directory, which contains neither docs/ nor the repository layout.
const skillRoot = join(import.meta.dir, "..");
const detailsDir = join(skillRoot, "details");
const detailFiles = readdirSync(detailsDir).filter((name) =>
  name.endsWith(".md"),
);
const agentDocs = [
  { name: "SKILL.md", text: readFileSync(join(skillRoot, "SKILL.md"), "utf8") },
  ...detailFiles.map((name) => ({
    name: `details/${name}`,
    text: readFileSync(join(detailsDir, name), "utf8"),
  })),
];

const unreachable: Array<[string, RegExp]> = [
  ["ADR number", /\bADR \d{4}\b/u],
  ["GitHub issue or PR link", /github\.com\/[^\s)]+\/(?:issues|pull)\/\d+/u],
  ["repository-relative skill path", /\bskills\/fusion\//u],
  ["repository docs path", /\bdocs\/fusion\b/u],
];

describe("agent-facing skill docs", () => {
  for (const { name, text } of agentDocs) {
    for (const [label, pattern] of unreachable) {
      test(`${name} has no ${label}`, () => {
        expect(text.match(pattern)?.[0]).toBeUndefined();
      });
    }
  }

  test("SKILL.md links every details file, and only existing ones", () => {
    const skill = agentDocs[0]!.text;
    const linked = new Set(
      [...skill.matchAll(/details\/([\w.-]+\.md)/gu)].map((match) => match[1]!),
    );
    expect([...linked].sort()).toEqual([...detailFiles].sort());
  });

  test("SKILL.md compatibility states the OpenCode range the code enforces", () => {
    const frontmatter = agentDocs[0]!.text.split(/^---$/mu)[1]!;
    // The field value: its own line plus the indented continuation lines.
    const compatibility = /^compatibility:(.*\n(?:[ \t]+.*\n)*)/mu.exec(
      frontmatter,
    )?.[1];
    expect(compatibility?.replace(/\s+/gu, " ")).toContain(
      `OpenCode ${SUPPORTED_OPENCODE_VERSIONS}.`,
    );
  });

  test("details files reference only existing sibling files", () => {
    for (const { name, text } of agentDocs.slice(1)) {
      // Lowercase names are details files; uppercase ones such as AGENTS.md
      // name harness concepts, not skill files.
      for (const [, file] of text.matchAll(/`(\.\.\/SKILL\.md|[a-z][\w-]*\.md)`/gu)) {
        const target =
          file === "../SKILL.md"
            ? join(skillRoot, "SKILL.md")
            : join(detailsDir, file!);
        expect(existsSync(target), `${name} -> ${file}`).toBe(true);
      }
    }
  });
});
