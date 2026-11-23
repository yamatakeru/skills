# Fusion

Fusion is an agent skill that runs a blind panel: several models answer the
same task independently, a separate judge compares their answers
(consensus, contradictions, partial coverage, unique insights, blind spots),
and the calling agent writes the final answer. It is inspired by OpenRouter's
[Fusion](https://openrouter.ai/docs/guides/features/plugins/fusion) but does
not call the OpenRouter API.

`SKILL.md` is the guide the calling agent follows. This README is for people
installing or maintaining the skill.

## When to use

Use it when independent second opinions are likely to change or sharpen a
conclusion: open research questions, architecture or design choices, critique
of a plan or spec, or a multi-model second-opinion review. Do not use it for
narrow lookups or routine single-pass code review; a run takes minutes and
calls several models.

Ask the agent explicitly, for example:

```text
fusionを使って、この設計変更のリスクと実装方針を独立に評価して。
```

## Requirements

- [Bun](https://bun.sh/docs/installation) on the machine where the calling
  agent runs. The CLI has no npm runtime dependencies.
- At least one worker harness: Claude Code, OpenCode, or Cursor
  (`cursor-agent`). Supported OpenCode versions are listed in the
  `compatibility` field of `SKILL.md`.

## Install and update

With the `skills` CLI:

```bash
npx skills add yamatakeru/skills --skill fusion   # add -g for a user-level install
npx skills update fusion
```

The CLI records the installed commit, so an installed copy does not change
until you update it. Update after changes that affect the runtime, for example
when a newer OpenCode release becomes supported.

### Optional OpenCode configuration

OpenCode can use the skill without extra configuration if the skill is
discoverable and permissions allow it. To allow it without a prompt:

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

Restart OpenCode after changing its configuration.

## Models

`bun bin/fusion-run.ts --help` prints every option, the alias table, and the
ordered fallback chain behind each alias. `details/runtime.md` explains how
entries route to harnesses and how the default panel is composed. To list
available model IDs, run `opencode models` or `cursor-agent models`.

## Layout

```text
SKILL.md      Guide for the calling agent
details/      References SKILL.md links for specific situations
bin/          fusion-run.ts (panel CLI) and fusion-judge-replay.ts
lib/          TypeScript implementation; lib/protocol.ts is the public entry
schema/       JSON Schemas generated from lib/types.ts
test/         Bun tests
```

## Library use

`lib/protocol.ts` exports the harness-neutral implementation: request and
result types, panel composition, worker request construction, compliance
evaluation, recording, and `runPanel`, which orchestrates injected worker and
synthesis adapters. In `PanelSpec.workers`, each slot may carry a
`{ model, harness }` preference.

## Design documents

The portable spec, glossary, domain model, ADRs and runbook live in
[`docs/fusion/`](../../docs/fusion/) of the source repository.

## Limits

Fusion coordinates independent blind-panel deliberation. It is not a
role-divided review workflow and not a multi-worker coding system. Its worker
containment is a harness allowlist, not a sandbox.
