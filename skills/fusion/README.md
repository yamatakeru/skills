# Fusion

Fusion is a lightweight skill for Fusion-inspired blind-panel deliberation. It
is designed for complex research, architecture, design review, code review,
debugging, and other high-stakes or ambiguous tasks where one answer is not
enough.

The skill is inspired by OpenRouter's [Fusion](https://openrouter.ai/docs/guides/features/plugins/fusion)
system: independent same-prompt answers are compared and synthesized into
consensus, contradictions, partial coverage, unique insights, and blind spots.
It does not call the OpenRouter Fusion API directly.

For role-divided review with scout, architect, critic and verifier agents, use
the separate `council` skill.

## Repository Layout

```text
skills/
  fusion/
    SKILL.md      # The portable blind-panel skill definition
    README.md     # This file
    details/      # Optional deep-dive guidance; not required at runtime
agents/
  fusion-panelist.md
```

The `SKILL.md` file is the core artifact and contains the complete runtime
protocol. The files under `details/` are optional guidance; the skill should
still work correctly if they are not read. `fusion-panelist.md` is an optional
OpenCode hidden subagent for stronger independent-panel behavior.

## When To Use

Use Fusion for:

- research questions with competing interpretations
- architecture or design decisions needing independent judgment
- risky implementation plans where independent convergence matters
- code review where missing an issue would be costly
- tasks where the user explicitly asks for a panel, ensemble, fusion, or
  multi-model answer

Do not use it for small factual questions, simple edits, obvious bug fixes, or
tasks where latency and token cost are not justified.

## Basic Installation

Install the skill by making `skills/fusion/SKILL.md` visible to your agent
harness.

For OpenCode project-local use, copy the skill directory into the target
repository:

```bash
mkdir -p /path/to/your/repo/.opencode/skills
cp -R skills/fusion /path/to/your/repo/.opencode/skills/
```

For OpenCode project-local hidden subagents, copy the panelist file into
`.opencode/agent/` or `.opencode/agents/`:

```bash
mkdir -p /path/to/your/repo/.opencode/agent
cp agents/fusion-panelist.md /path/to/your/repo/.opencode/agent/
```

## OpenCode Optional Configuration

OpenCode can use the skill without extra configuration if the skill and agent
are already discoverable and permissions allow them. The following
`opencode.jsonc` fragment is optional.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "skill": {
      "*": "ask",
      "fusion": "allow"
    }
  },
  "agent": {
    "build": {
      "permission": {
        "skill": {
          "*": "ask",
          "fusion": "allow"
        },
        "task": {
          "*": "ask",
          "fusion-panelist": "allow"
        }
      }
    }
  }
}
```

After changing OpenCode configuration, restart OpenCode. Configuration, skill,
agent, and plugin files are loaded at startup.

## Model Setup

`fusion-panelist.md` may inherit the invoking primary agent's model. For model
diversity, copy it to files such as `fusion-panelist-openai.md`,
`fusion-panelist-claude.md`, or `fusion-panelist-gemini.md`, then set different
`model:` lines in their frontmatter.

Use this command to inspect available models:

```bash
opencode models
```

## Usage

Ask for the skill explicitly when the task warrants independent deliberation:

```text
fusionを使って、この設計変更のリスクと実装方針を独立に評価して。
```

```text
fusion --panelists 3 で、このAPI設計案をレビューして。
```

```text
fusion --verify で、このバグ修正方針を評価して。実装はまだしないで。
```

## Limits

Fusion coordinates independent blind-panel deliberation. It is not a
role-divided review workflow and is not a full multi-worker coding system. For
explicit role division, use `council`.
