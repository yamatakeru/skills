# Fusion Council

Fusion Council is a lightweight skill for Fusion-inspired multi-agent deliberation. It is designed for complex research, architecture, design review, code review, debugging, and other high-stakes or ambiguous tasks where a single answer is not enough.

The skill is inspired by OpenRouter's [Fusion](https://openrouter.ai/docs/guides/features/plugins/fusion) system: independent answers are compared and synthesized into consensus, contradictions, partial coverage, unique insights, and blind spots. This repository adds an agentic-coding extension for OpenCode through optional hidden subagents.

This package is skill-first. It does not require an OpenCode plugin, MCP server, extension, or external orchestrator.

## Repository Layout

```text
skills/
  fusion-council/
    SKILL.md      # The portable skill definition
    README.md     # This file
agents/
  fusion-scout.md
  fusion-architect.md
  fusion-critic.md
  fusion-verifier.md
  fusion-panelist.md
```

The `SKILL.md` file is the core artifact. The files under `agents/` are optional OpenCode subagents that make the council more useful when OpenCode can spawn hidden subagents.

## Modes

Fusion Council supports two deliberation styles:

- `Blind Independent Panel`: closest to OpenRouter Fusion. Multiple neutral panelists receive the same prompt independently, then the parent agent synthesizes their answers.
- `Role-based Council`: an OpenCode-oriented extension. Specialized subagents inspect the task from different angles such as context gathering, architecture, criticism, and verification.

Use the blind panel when model-independent convergence is the main goal. Use the role-based council when a coding or design task benefits from explicit division of labor.

## When To Use

Use Fusion Council for:

- architecture decisions
- design review
- complex debugging
- risky implementation plans
- code review where missing an issue would be costly
- research questions with competing interpretations
- tasks where the user explicitly asks for a panel, ensemble, fusion, or council

Do not use it for small factual questions, simple edits, obvious bug fixes, or tasks where the latency and token cost are not justified.

## Basic Installation

Install the skill by making `skills/fusion-council/SKILL.md` visible to your agent harness.

For OpenCode project-local use, copy the skill directory into the target repository:

```bash
mkdir -p /path/to/your/repo/.opencode/skills
cp -R skills/fusion-council /path/to/your/repo/.opencode/skills/
```

For OpenCode project-local hidden subagents, copy the agent files into `.opencode/agent/` or `.opencode/agents/`:

```bash
mkdir -p /path/to/your/repo/.opencode/agent
cp agents/fusion-*.md /path/to/your/repo/.opencode/agent/
```

If your agent harness already loads skills from this repository directly, you do not need to copy the files. Configure the harness to scan this repository's `skills/` directory instead.

## OpenCode Optional Configuration

OpenCode can use the skill without extra configuration if the skill and agents are already discoverable and permissions allow them. The following `opencode.jsonc` fragment is optional. Use it only when you want to pre-allow `fusion-council` and the hidden `fusion-*` subagents.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",

  // Optional project-level default. You can omit this and rely on your global OpenCode config.
  "model": "openai/gpt-5.5",

  "permission": {
    // Let agents load the fusion-council skill without prompting.
    "skill": {
      "*": "ask",
      "fusion-council": "allow"
    }
  },

  "agent": {
    // Optional: tune built-in primary agents so they can call hidden Fusion subagents.
    "build": {
      "permission": {
        "skill": {
          "*": "ask",
          "fusion-council": "allow"
        },
        "task": {
          "*": "ask",
          "fusion-*": "allow"
        }
      }
    },

    "plan": {
      "permission": {
        "skill": {
          "*": "ask",
          "fusion-council": "allow"
        },
        "task": {
          "*": "ask",
          "fusion-*": "allow"
        },
        "edit": "deny",
        "bash": "ask"
      }
    }
  }
}
```

After changing OpenCode configuration, restart OpenCode. Configuration, skill, agent, and plugin files are loaded at startup.

## Model Setup

The hidden agents may specify concrete `model:` values in their frontmatter. Replace them with model IDs available in your OpenCode setup, or remove/comment the `model:` lines to inherit the invoking primary agent's model.

Use this command to inspect available models:

```bash
opencode models
```

Typical mapping:

- `fusion-scout`: fast and inexpensive model
- `fusion-architect`: strongest reasoning or design model
- `fusion-critic`: different provider or strong review model
- `fusion-verifier`: precise coding and verification model
- `fusion-panelist`: neutral model for blind-panel mode; copy this file to create model-specific panelists when you want model diversity

## Usage

Ask for the skill explicitly when the task warrants deliberation:

```text
fusion-councilを使って、この設計変更のリスクと実装方針を比較して。
```

```text
このバグ修正方針をfusion-councilでレビューして。実装はまだしないで。
```

For blind-panel style review, ask for that mode directly:

```text
fusion-councilのblind panelで、このAPI設計案を独立に評価して。
```

## Limits

Fusion Council coordinates deliberation; it is not a full multi-worker coding system. For worktrees, automatic retries, diff aggregation, long-running verification, or CI-integrated multi-agent execution, use a plugin, extension, external orchestrator, or CI workflow.
