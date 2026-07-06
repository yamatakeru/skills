# Fusion

Fusion is a lightweight skill for Fusion-inspired blind-panel deliberation. It
is designed for complex research, architecture, design review, code review,
debugging, and other high-stakes or ambiguous tasks where one answer is not
enough.

The skill is inspired by OpenRouter's [Fusion](https://openrouter.ai/docs/guides/features/plugins/fusion)
system: independent same-prompt answers are compared and synthesized into
consensus, contradictions, partial coverage, unique insights, and blind spots.
It does not call the OpenRouter Fusion API directly.

## Repository Layout

```text
skills/
  fusion/
    bin/          # Bundled Bun CLI entrypoint
    SKILL.md      # The portable blind-panel skill definition
    README.md     # This file
    details/      # Optional deep-dive guidance; not required at runtime
    lib/          # Portable TypeScript protocol reference implementation
```

The `SKILL.md` file is the core artifact and contains the complete runtime
protocol. The files under `details/` are optional guidance; the skill should
still work correctly if they are not read. `bin/fusion-run.ts` is the
canonical execution path. `lib/protocol.ts` is the public TypeScript entry
point for the harness-neutral reference implementation. The implementation is
split across `lib/*.ts` by responsibility: request/result types, manifest
helpers, panel composition, worker request construction, event logging,
compliance evaluation, recording, and `runPanel` orchestration around injected
worker and synthesis adapters.

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

Bun must be installed on the machine where the parent agent runs the skill.
The skill runtime itself has no npm runtime dependencies.

## OpenCode Optional Configuration

OpenCode can use the skill without extra configuration if the skill is
discoverable and permissions allow it. The following
`opencode.jsonc` fragment is optional.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "skill": {
      "*": "ask",
      "fusion": "allow"
    }
  }
}
```

After changing OpenCode configuration, restart OpenCode. Configuration, skill,
and plugin files are loaded at startup.

## Model Setup

The CLI composes a default three-worker panel from `--parent-model`, the
`openai-flagship` alias, and the `budget-smart` alias. Use `--models` to
replace that default composition with explicit model entries. Use this command
to inspect OpenCode-backed model IDs:

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
fusion --models sonnet,openai-flagship,budget-smart で、このAPI設計案をレビューして。
```

Supported model entries are provider-qualified OpenCode models such as
`openai/gpt-5.5`, Claude aliases such as `sonnet`, alias-table names such as
`openai-flagship` and `budget-smart`, and explicit harness prefixes such as
`opencode:openai/gpt-5.5` or `claude-code:sonnet`. Unknown entries are errors.

## Limits

Fusion coordinates independent blind-panel deliberation. It is not a
role-divided review workflow and is not a full multi-worker coding system.
