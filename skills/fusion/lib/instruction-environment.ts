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
        note: "Claude Code user, project, and local memory layers (CLAUDE.md, CLAUDE.local.md, and their imports) are blocked via an empty --setting-sources list, and auto memory is disabled via --settings autoMemoryEnabled=false (ADR 0045); no persistent instruction layer is loaded.",
        summary:
          "claude-code=memory layers and auto memory blocked via empty setting-sources and autoMemoryEnabled=false",
      },
    ];
  }

  if (harness.kind === "opencode" && harness.transport === "sdk") {
    return [
      {
        note: "Fusion-owned OpenCode v2 SDK servers redirect OPENCODE_CONFIG_DIR and XDG_CONFIG_HOME to an empty run-scoped directory and unset OPENCODE_CONFIG, blocking user/global config instructions and rule files (ADR 0046); project and ancestor AGENTS.md still inject. Web search uses the explicitly selected Exa provider without changing user settings. Injected external servers do not carry this startup-isolation claim.",
        summary:
          "opencode(sdk)=owned-server user/global instruction layers blocked via config-dir redirect, project and ancestor AGENTS.md still inject, external startup uncontrolled",
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
