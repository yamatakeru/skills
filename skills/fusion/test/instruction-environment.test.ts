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
        note: "Fusion-owned OpenCode v2 SDK servers redirect OPENCODE_CONFIG_DIR and XDG_CONFIG_HOME to an empty run-scoped directory and unset OPENCODE_CONFIG, blocking user/global config instructions and rule files (ADR 0046); project and ancestor AGENTS.md still inject. Web search uses the explicitly selected Exa provider without changing user settings. Injected external servers do not carry this startup-isolation claim.",
        summary:
          "opencode(sdk)=owned-server user/global instruction layers blocked via config-dir redirect, project and ancestor AGENTS.md still inject, external startup uncontrolled",
      },
    ]);
    expect(
      instructionEnvironmentDisclosures({
        kind: "opencode",
        transport: "cli",
      }),
    ).toEqual([]);
  });

  test("keeps the prior Cursor User Rules note byte-identical", () => {
    const [cursor] = instructionEnvironmentDisclosures({
      kind: "cursor",
      transport: "sdk",
    });

    expect(cursor).toEqual({
      note: "Cursor account-level User Rules inject into headless sessions regardless of CURSOR_CONFIG_DIR; this is an environment input, not a panel-state isolation breaker.",
      summary:
        "cursor=account User Rules inject regardless of CURSOR_CONFIG_DIR",
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
