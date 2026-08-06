import { describe, expect, test } from "bun:test";
import { instructionEnvironmentDisclosures } from "../lib/protocol";

describe("instruction environment disclosures", () => {
  test("returns the normative static entry for each supported harness and transport", () => {
    const claudeCode = [
      {
        note: "Claude Code injects user-level memory (~/.claude/CLAUDE.md and its imports) and project-level memory (CLAUDE.md resolved from the session cwd, plus imports) by default; no setting-source suppression is applied.",
        summary:
          "claude-code=user/project memory injected by default, no setting-source suppression",
      },
    ];

    expect(
      instructionEnvironmentDisclosures({
        kind: "claude-code",
        transport: "sdk",
      }),
    ).toEqual(claudeCode);
    expect(
      instructionEnvironmentDisclosures({
        kind: "claude-code",
        transport: "cli",
      }),
    ).toEqual(claudeCode);
    expect(
      instructionEnvironmentDisclosures({
        kind: "opencode",
        transport: "sdk",
      }),
    ).toEqual([
      {
        note: "OpenCode SDK sessions can receive user-level config instructions, global rule files, and project AGENTS.md through user-config merge.",
        summary:
          "opencode(sdk)=can receive user config instructions, global rule files, and project AGENTS.md via user-config merge",
      },
    ]);
    expect(
      instructionEnvironmentDisclosures({
        kind: "opencode",
        transport: "cli",
      }),
    ).toEqual([
      {
        note: "OpenCode CLI sessions can receive user-level config instructions, global rule files, and project AGENTS.md through user-config merge; the CLI transport passes --pure, and its suppression effect on instruction loading is unverified.",
        summary:
          "opencode(cli)=can receive user config instructions, global rule files, and project AGENTS.md via user-config merge, --pure effect on instruction loading unverified",
      },
    ]);
  });

  test("keeps the prior Cursor User Rules note byte-identical", () => {
    const [cursor] = instructionEnvironmentDisclosures({
      kind: "cursor",
      transport: "sdk",
    });

    expect(cursor).toEqual({
      note: "Cursor account-level User Rules inject into headless sessions regardless of CURSOR_CONFIG_DIR; this is an environment input, not a panel-state isolation breaker.",
      summary: "cursor=account User Rules inject regardless of CURSOR_CONFIG_DIR",
    });
  });

  test("does not invent facts for unsupported harness transports", () => {
    expect(
      instructionEnvironmentDisclosures({ kind: "cursor", transport: "cli" }),
    ).toEqual([]);
    expect(
      instructionEnvironmentDisclosures({ kind: "pi", transport: "sdk" }),
    ).toEqual([]);
  });
});
