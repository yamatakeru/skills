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
        note: "Claude Code user and project memory layers (CLAUDE.md files and their imports) are blocked via --setting-sources local (ADR 0045); no persistent instruction layer is loaded.",
        summary:
          "claude-code=user/project memory blocked via --setting-sources local",
      },
    ];
  }

  if (harness.kind === "opencode" && harness.transport === "sdk") {
    return [
      {
        note: "OpenCode SDK sessions run with XDG_CONFIG_HOME redirected to a run-scoped empty config directory, blocking user config instructions and global rule files (ADR 0045); project AGENTS.md from the session cwd still injects.",
        summary:
          "opencode(sdk)=user/global instruction layers blocked via config-dir redirect, project AGENTS.md still injects",
      },
    ];
  }

  if (harness.kind === "opencode" && harness.transport === "cli") {
    return [
      {
        note: "OpenCode CLI sessions receive user-level config instructions, global rule files, and project AGENTS.md through user-config merge; no blocking means exists on this path, and --pure is verified plugins-only (it does not suppress instruction loading).",
        summary:
          "opencode(cli)=user config instructions, global rule files, and project AGENTS.md inject, no blocking means, --pure verified plugins-only",
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
