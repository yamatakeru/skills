# fusion-council-opencode

A lightweight OpenCode skill and optional hidden subagent setup for [Fusion](https://openrouter.ai/docs/guides/features/plugins/fusion)-like multi-agent deliberation.

This package is intentionally skill-first. It does not require an OpenCode plugin or extension.

## Files

```text
skills/
  fusion-council/
    SKILL.md
agents/
  fusion-scout.md
  fusion-architect.md
  fusion-critic.md
  fusion-verifier.md
opencode.fusion.example.jsonc
INSTALL.md
```

## Intended use

Use it for design review, research, architecture decisions, complex debugging, and nontrivial coding judgement.

For advanced multi-worker coding with worktrees, automatic tests, diff aggregation, and retry logic, move from skill-only configuration to a plugin, extension, external orchestrator, or CI workflow.
