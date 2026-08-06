import { describe, expect, test } from "bun:test";
import { instructionEnvironmentDisclosures } from "../lib/protocol";

describe("instruction environment disclosures", () => {
  test("returns the normative static entry for each supported harness and transport", () => {
    const claudeCode = [
      {
        note: "Claude Code user, project, and local memory layers (CLAUDE.md, CLAUDE.local.md, and their imports) are blocked via an empty --setting-sources list, and auto memory is disabled via --settings autoMemoryEnabled=false (ADR 0045); no persistent instruction layer is loaded.",
        summary:
          "claude-code=memory layers and auto memory blocked via empty setting-sources and autoMemoryEnabled=false",
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
        note: "OpenCode SDK sessions run with XDG_CONFIG_HOME redirected to a run-scoped empty config directory, blocking user config instructions and global rule files (ADR 0045); project AGENTS.md from the session cwd still injects.",
        summary:
          "opencode(sdk)=user/global instruction layers blocked via config-dir redirect, project AGENTS.md still injects",
      },
    ]);
    expect(
      instructionEnvironmentDisclosures({
        kind: "opencode",
        transport: "cli",
      }),
    ).toEqual([
      {
        note: "OpenCode CLI sessions receive user-level config instructions and global rule files through user-config merge, and project AGENTS.md from the session cwd; no blocking mechanism exists on this path, and --pure is verified plugins-only (it does not suppress instruction loading).",
        summary:
          "opencode(cli)=user config instructions, global rule files, and cwd AGENTS.md inject, no blocking mechanism, --pure verified plugins-only",
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

  test("keeps report-safe summaries free of semicolons", () => {
    for (const harness of [
      { kind: "claude-code" as const, transport: "sdk" as const },
      { kind: "claude-code" as const, transport: "cli" as const },
      { kind: "opencode" as const, transport: "sdk" as const },
      { kind: "opencode" as const, transport: "cli" as const },
      { kind: "cursor" as const, transport: "sdk" as const },
    ]) {
      for (const disclosure of instructionEnvironmentDisclosures(harness)) {
        expect(disclosure.summary).not.toContain(";");
      }
    }
  });
});
