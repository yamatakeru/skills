---
name: fusion
description: >-
  Fusion-inspired blind-panel deliberation for comparison-shaped tasks—deep
  research, architecture, design review, code review, and other work where
  independent perspectives are likely to change or sharpen the conclusion. The
  bundled Bun CLI runs neutral same-prompt workers, then a harness-backed judge
  compares worker outputs so the parent agent can write the final answer.
license: MIT
compatibility: >-
  SKILL.md-compatible agents with shell access and Bun installed. Uses the
  bundled self-contained TypeScript CLI; no node_modules are required inside the
  skill directory.
metadata:
  version: "0.7.0"
  kind: "blind-panel synthesis"
  mode: "blind"
  canonical-runtime: "bun-cli"
---

# Fusion

Fusion is a skill-level blind-panel deliberation protocol inspired by
OpenRouter Fusion's panel-and-synthesis workflow. It is not an OpenRouter
Fusion API wrapper and does not call the OpenRouter Fusion API directly.

Use Fusion for comparison-shaped tasks—deep research, design exploration,
review-angle sweeps, and other ambiguous or open-ended work where independent
perspectives are likely to change or sharpen the conclusion—or when a panel is
explicitly requested. Match the panel to the stakes: cheap-model panels make
casual use reasonable for exploratory work, while flagship-mixed panels suit
high-stakes or hard-to-reverse decisions. Answer trivial or narrow tasks
directly.

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

Pass the background the panel needs through `--context` (a short brief you
author) and `--context-file` (repeatable, embeds file contents). Workers only
see the task prompt and this shared context; do not assume they know the
conversation. For high-stakes tasks you may raise worker reasoning depth with
`--effort`; the default leaves each provider's default untouched.

Bun is required. If `bun` is missing, first surface a clear error with
installation guidance, for example: "Fusion requires Bun. Install it from
https://bun.sh/docs/installation and rerun the CLI." Never substitute another
execution path silently; the only permitted degradation is the announced
Emergency Fallback described below.

## Judge-Backed Synthesis

By default the CLI runs the panel, then invokes a separate no-tools judge
through the same headless adapter path. The judge compares worker outputs; it
does not merge them, choose a winner, or write the final answer.

Read the CLI report, verify load-bearing claims with your own read tools where
needed, then the parent agent must author the final answer grounded in the
judge analysis and worker outputs. The judge analysis uses these five findings:

1. **Consensus**: what independent workers converged on.
2. **Contradictions**: mutually exclusive claims or recommendations.
3. **Partial coverage**: important topics only some workers covered.
4. **Unique insights**: valuable single-worker observations.
5. **Blind spots**: relevant questions or evidence nobody addressed.

If the judge fails, times out, or returns invalid core JSON, the run remains
usable: the report warns, omits structured `analysis`, and falls back to the
previous parent-agent flow using raw worker outputs plus deterministic audit
synthesis. Explicit `--synthesizer parent-agent` and `--synthesizer
deterministic` remain escape hatches.

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

The judge model defaults to the parent model. Use `--judge-model <entry>` to
override it; judge model entries use the same routing rules as panel model
entries.

## CLI Options

- `--parent-model <id>`: parent model for the default panel slot.
- `--models <comma-list>`: explicit model list; replaces default composition.
- `--panelists <n>`: panel size for default composition; default is 3,
  maximum is 20.
- `--context <text>`: shared context brief given to every worker.
- `--context-file <path>`: embed a file into the shared context; repeatable.
- `--effort <low|medium|high|xhigh>`: worker reasoning effort; default is the
  provider default.
- `--reasoning-max-tokens <n>`: worker reasoning token budget.
- `--max-turns <n>`: per-worker turn budget where the harness supports it.
- `--transport <sdk|cli>`: worker and judge transport; default is `sdk`.
  `cli` is an explicit opt-in to the legacy CLI adapters with degraded
  compliance evidence; the runtime never falls back to it silently.
- `--read-root <dir>`: declare a directory outside the workspace as readable
  (recursive) for every worker in the run; repeatable.
- `--record`: write split artifacts under `.fusion-runs/<panelRunId>/` when
  the directory is git-ignored.
- `--json`: print the complete `PanelResult` JSON instead of Markdown.
- `--judge-model <entry>`: override the judge model; defaults to
  `--parent-model` when available.
- `--synthesizer <parent-agent|deterministic|opencode|claude-code>`:
  harness-backed judge is the default; `parent-agent` and `deterministic` are
  explicit-only escapes.
- `--timeout-ms <n>`: per-worker timeout.

Reasoning and budget options a harness cannot honor are reported as warnings
in the panel report, never silently dropped.

Default Markdown output starts with run status, compliance tier, and warnings,
then lists each worker's full output with worker id, model, harness, and
status, then the judge analysis. When the judge did not run or failed, the
report shows deterministic audit synthesis instead. Exit code is 0 for `ok`
and `partial`, and 1 for `failed` or usage errors.

## Worker Rules

All workers must receive the same full task prompt and shared context. Do not
assign roles, personas, debate positions, or specialty lenses. Do not show any
worker peer outputs, draft synthesis, or panel conclusions before it returns.
Do not request, expose, synthesize, or record private chain-of-thought; workers
should provide concise reasoning summaries, evidence, sources, assumptions,
uncertainties, and verification notes instead.

Default worker tools are read-only local access, a read-only bash allowlist
(git inspection plus read-only search and listing commands), and web search
and web fetch where the harness provides them. Workers must not edit or write
files, run destructive or non-allowlisted shell commands, spawn subagents,
delegate subtasks, or recursively invoke panels.

Reads outside the workspace are denied unless the parent declares the
directory with `--read-root`. A denied request surfaces to the worker as a
structured tool error: the worker keeps running and discloses the denial in
its answer instead of being dropped from the panel.

## Partial Results

Partial failure is allowed by default. If at least one worker succeeds, the CLI
continues with status `partial` and discloses failed workers and reasons. If
all workers fail, the run status is `failed`. The parent-authored synthesis and
final answer must acknowledge missing workers and must not present partial
results as full-panel consensus.

## Emergency Fallback

If the CLI cannot run at all, for example because Bun is missing (after
surfacing the installation error above) or no usable harness exists, an
internal same-agent blind-panel simulation is permitted only as an emergency
fallback. Announce the degraded status before producing
results. Keep the same prompt separated across passes, preserve the five
findings, and state that this is not a full-compliance Fusion panel. Removal of
this fallback will be reconsidered once the skill matures.

## Supplementary Details

The runtime protocol above is complete and authoritative. These files are
optional background and must not contradict the CLI path:

- `details/blind-panel.md`
- `details/synthesis.md`
- `details/provenance.md`
