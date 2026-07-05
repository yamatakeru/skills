---
name: fusion
description: >-
  Fusion-inspired blind-panel deliberation for complex research, architecture,
  design review, code review, and other high-stakes or ambiguous tasks. The
  bundled Bun CLI runs neutral same-prompt workers, then the parent agent writes
  the five-finding synthesis and final answer from the panel report.
license: MIT
compatibility: >-
  SKILL.md-compatible agents with shell access and Bun installed. Uses the
  bundled self-contained TypeScript CLI; no node_modules are required inside the
  skill directory.
metadata:
  version: "0.5.0"
  kind: "blind-panel synthesis"
  mode: "blind"
  canonical-runtime: "bun-cli"
---

# Fusion

Fusion is a skill-level blind-panel deliberation protocol inspired by
OpenRouter Fusion's panel-and-synthesis workflow. It is not an OpenRouter
Fusion API wrapper and does not call the OpenRouter Fusion API directly.

Use Fusion for ambiguous, high-stakes, open-ended, or explicitly requested
panel/ensemble/fusion tasks. Answer trivial or narrow tasks directly.

## Canonical Execution Path

The bundled CLI is the single canonical panel execution path. Run it through
the parent harness shell tool:

```bash
bun <skill-dir>/bin/fusion-run.ts --parent-model <its own model id> "task"
```

`<skill-dir>` is the installed Fusion skill directory. Pass the parent agent's
own model as `--parent-model` whenever it can be expressed as a supported model
entry. If the parent model is unavailable, omit it; the CLI will warn and
refill the slot from fallback lists.

Bun is required. If `bun` is missing, produce a clear error with installation
guidance, for example: "Fusion requires Bun. Install it from
https://bun.sh/docs/installation and rerun the CLI." Do not silently fall back.

## Parent-Agent Synthesis

Read the CLI report, then the parent agent must author the synthesis and final
answer. Use these five findings:

1. **Consensus**: what independent workers converged on.
2. **Contradictions**: mutually exclusive claims or recommendations.
3. **Partial coverage**: important topics only some workers covered.
4. **Unique insights**: valuable single-worker observations.
5. **Blind spots**: relevant questions or evidence nobody addressed.

The CLI always emits deterministic synthesis as an audit reference. When
`--synthesizer parent-agent` is used, which is the default, do not treat that
deterministic text as the final answer. The parent agent authors the final
answer grounded in the worker outputs and the five findings.

## Default Panel Composition

The default panel has three workers. Same-harness panels are allowed. Default
slots are filled in this priority order:

1. Parent model slot from `--parent-model`.
2. Current OpenAI flagship through OpenCode via the `openai-flagship` alias.
3. Cheap-but-capable budget model through OpenCode via the `budget-smart`
   alias.

If `--parent-model` is missing, the CLI warns and refills that slot from the
bundled alias fallback lists. Default duplicate model IDs are deduped and
refilled so the default panel has distinct models. Repeating a model is allowed
only through explicit `--models` selection.

## Model Selection

`--models <comma-list>` replaces the default composition entirely.

Model entry routing:

- `provider/model` routes to OpenCode.
- Claude aliases `fable`, `opus`, `sonnet`, `haiku`, and `claude-*` IDs route
  to Claude Code.
- `openai-flagship` and `budget-smart` resolve through the bundled alias table.
- `opencode:<entry>` and `claude-code:<entry>` force the harness.
- Unknown entries are errors, not guesses.

OpenCode-backed entries are checked against `opencode models`. Claude Code has
no model enumeration command; Claude-backed entries use latest aliases and
`--fallback-model`, then are validated by the worker attempt.

## CLI Options

- `--parent-model <id>`: parent model for the default panel slot.
- `--models <comma-list>`: explicit model list; replaces default composition.
- `--panelists <n>`: panel size for default composition; default is 3.
- `--record`: write split artifacts under `.fusion-runs/<panelRunId>/` when
  the directory is git-ignored.
- `--json`: print the complete `PanelResult` JSON instead of Markdown.
- `--synthesizer <parent-agent|deterministic|harness-kind>`: default is
  `parent-agent`; `deterministic` is implemented; harness-kind synthesis is
  contract-reserved and must error as not implemented yet.
- `--timeout-ms <n>`: per-worker timeout.

Default Markdown output starts with run status, compliance tier, and warnings,
then lists each worker's full output with worker id, model, harness, and
status, then the deterministic audit synthesis, then recording status. Exit
code is 0 for `ok` and `partial`, and 1 for `failed` or usage errors.

## Worker Rules

All workers must receive the same full task prompt and shared context. Do not
assign roles, personas, debate positions, or specialty lenses. Do not show any
worker peer outputs, draft synthesis, or panel conclusions before it returns.
Do not request, expose, synthesize, or record private chain-of-thought; workers
should provide concise reasoning summaries, evidence, sources, assumptions,
uncertainties, and verification notes instead.

Default worker tools are read-only local access plus web search and web fetch
where the harness provides them. Workers must not edit or write files, run
destructive commands, spawn subagents, delegate subtasks, or recursively invoke
panels.

## Partial Results

Partial failure is allowed by default. If at least one worker succeeds, the CLI
continues with status `partial` and discloses failed workers and reasons. If
all workers fail, the run status is `failed`. The parent-authored synthesis and
final answer must acknowledge missing workers and must not present partial
results as full-panel consensus.

## Emergency Fallback

If the CLI cannot run at all, for example because Bun is missing or no usable
harness exists, an internal same-agent blind-panel simulation is permitted only
as an emergency fallback. Announce the degraded status before producing
results. Keep the same prompt separated across passes, preserve the five
findings, and state that this is not a full-compliance Fusion panel. Removal of
this fallback will be reconsidered once the skill matures.

## Supplementary Details

The runtime protocol above is complete and authoritative. These files are
optional background and must not contradict the CLI path:

- `details/blind-panel.md`
- `details/synthesis.md`
- `details/provenance.md`
