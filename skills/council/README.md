# Council

Council is a role-divided structured-review skill for complex coding,
architecture, design review, debugging, migration planning, and other
high-stakes tasks where explicit division of labor improves judgment.

Council is separate from `fusion`. Use `fusion` for same-prompt blind-panel
synthesis. Use `council` when you want specialized roles such as scout,
architect, critic and verifier.

## Repository Layout

```text
skills/
  council/
    SKILL.md      # The portable role-review skill definition
    README.md     # This file
    details/      # Optional deep-dive guidance; not required at runtime
agents/
  council-scout.md
  council-architect.md
  council-critic.md
  council-verifier.md
```

The `SKILL.md` file is the core artifact and contains the complete runtime
protocol. The files under `details/` are optional guidance; the skill should
still work correctly if they are not read. The files under `agents/` are
optional OpenCode hidden subagents for role-divided review.

## When To Use

Use Council for:

- architecture and migration planning
- complex debugging
- risky implementation plans
- code review with correctness, security, or maintainability concerns
- design review requiring tradeoff analysis
- tasks where verification evidence materially changes the answer

Do not use it for small factual questions, simple edits, obvious bug fixes, or
tasks where latency and token cost are not justified.

## Basic Installation

Install the skill by making `skills/council/SKILL.md` visible to your agent
harness.

For OpenCode project-local use, copy the skill directory into the target
repository:

```bash
mkdir -p /path/to/your/repo/.opencode/skills
cp -R skills/council /path/to/your/repo/.opencode/skills/
```

For OpenCode project-local hidden subagents, copy the agent files into
`.opencode/agent/` or `.opencode/agents/`:

```bash
mkdir -p /path/to/your/repo/.opencode/agent
cp agents/council-*.md /path/to/your/repo/.opencode/agent/
```

## OpenCode Optional Configuration

OpenCode can use the skill without extra configuration if the skill and agents
are already discoverable and permissions allow them. The following
`opencode.jsonc` fragment is optional.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "skill": {
      "*": "ask",
      "council": "allow"
    }
  },
  "agent": {
    "build": {
      "permission": {
        "skill": {
          "*": "ask",
          "council": "allow"
        },
        "task": {
          "*": "ask",
          "council-*": "allow"
        }
      }
    }
  }
}
```

After changing OpenCode configuration, restart OpenCode. Configuration, skill,
agent, and plugin files are loaded at startup.

## Model Setup

The hidden agents may specify concrete `model:` values in their frontmatter.
Replace them with model IDs available in your OpenCode setup, or remove the
`model:` lines to inherit the invoking primary agent's model.

Typical mapping:

- `council-scout`: fast and inexpensive model
- `council-architect`: strongest reasoning or design model
- `council-critic`: different provider or strong review model
- `council-verifier`: precise coding and verification model

## Usage

Ask for the skill explicitly when the task warrants role-divided review:

```text
councilを使って、この設計変更のリスクと実装方針を比較して。
```

```text
council --roles scout,critic,verifier で、この変更方針をレビューして。
```

```text
council --verify で、このバグ修正方針の検証計画を立てて。実装はまだしないで。
```

## Limits

Council coordinates structured review; it is not a full multi-worker coding
system. The parent agent remains responsible for final judgment and any actual
implementation. For same-prompt blind-panel deliberation, use `fusion`.
