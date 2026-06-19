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
  fusion-panelist-gpt.md
  fusion-panelist-kimi.md
  fusion-panelist-deepseek.md
  fusion-panelist-glm.md
  fusion-panelist-composer.md
```

The `SKILL.md` file is the core artifact and contains the complete runtime
protocol. The files under `details/` are optional guidance; the skill should
still work correctly if they are not read. `fusion-panelist*.md` files are
optional OpenCode hidden subagents for stronger independent-panel behavior and
model diversity.

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

For OpenCode project-local hidden subagents, copy the panelist files into
`.opencode/agent/` or `.opencode/agents/`:

```bash
mkdir -p /path/to/your/repo/.opencode/agent
cp agents/fusion-panelist*.md /path/to/your/repo/.opencode/agent/
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
          "fusion-panelist": "allow",
          "fusion-panelist-gpt": "allow",
          "fusion-panelist-kimi": "allow",
          "fusion-panelist-deepseek": "allow",
          "fusion-panelist-glm": "allow",
          "fusion-panelist-composer": "allow"
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
diversity, use model-specific copies with different `model:` lines in their
frontmatter, such as:

- `fusion-panelist-gpt.md`
- `fusion-panelist-kimi.md`
- `fusion-panelist-deepseek.md`
- `fusion-panelist-glm.md`
- `fusion-panelist-composer.md`

Model-specific panelists are not roles or personas. They must receive the same
task prompt and output expectations; only the underlying model differs.

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
fusion --models gpt,kimi,deepseek で、このAPI設計案をレビューして。
```

```text
fusion --panelists 4 --models gpt,kimi で、この実装方針を評価して。
```

```text
fusion --verify で、このバグ修正方針を評価して。実装はまだしないで。
```

Supported model aliases are `gpt`, `kimi`, `deepseek`, `glm`, and `composer`.
When `--panelists` and `--models` are combined, Fusion uses the requested models
first and fills remaining slots with other neutral panelists. If `--models`
contains more entries than `--panelists`, the explicit model list becomes the
effective panel size unless cost or latency would be unreasonable.

## Limits

Fusion coordinates independent blind-panel deliberation. It is not a
role-divided review workflow and is not a full multi-worker coding system. For
explicit role division, use `council`.
