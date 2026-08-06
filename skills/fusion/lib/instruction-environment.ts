import type { HarnessDescriptor } from "./types";

export interface InstructionEnvironmentDisclosure {
  note: string;
  summary: string;
}

export function instructionEnvironmentDisclosures(
  harness: Pick<HarnessDescriptor, "kind" | "transport">,
): readonly InstructionEnvironmentDisclosure[] {
  if (harness.kind === "claude-code") {
    return [
      {
        note: "Claude Code injects user-level memory (~/.claude/CLAUDE.md and its imports) and project-level memory (CLAUDE.md resolved from the session cwd, plus imports) by default; no setting-source suppression is applied.",
        summary:
          "claude-code=user/project memory injected by default; no setting-source suppression",
      },
    ];
  }

  if (harness.kind === "opencode" && harness.transport === "sdk") {
    return [
      {
        note: "OpenCode SDK sessions can receive user-level config instructions, global rule files, and project AGENTS.md through user-config merge.",
        summary:
          "opencode(sdk)=can receive user config instructions, global rule files, and project AGENTS.md via user-config merge",
      },
    ];
  }

  if (harness.kind === "opencode" && harness.transport === "cli") {
    return [
      {
        note: "OpenCode CLI sessions can receive user-level config instructions, global rule files, and project AGENTS.md through user-config merge; the CLI transport passes --pure, and its suppression effect on instruction loading is unverified.",
        summary:
          "opencode(cli)=can receive user config instructions, global rule files, and project AGENTS.md via user-config merge; --pure effect on instruction loading unverified",
      },
    ];
  }

  if (harness.kind === "cursor" && harness.transport === "sdk") {
    return [
      {
        note: "Cursor account-level User Rules inject into headless sessions regardless of CURSOR_CONFIG_DIR; this is an environment input, not a panel-state isolation breaker.",
        summary:
          "cursor=account User Rules inject regardless of CURSOR_CONFIG_DIR",
      },
    ];
  }

  return [];
}
