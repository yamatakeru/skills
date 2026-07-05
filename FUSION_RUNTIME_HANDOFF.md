# Fusion Runtime Handoff

Date: 2026-07-05

This handoff captures the state of the Fusion runtime after the usable
milestone was implemented and smoke-verified. The design authority is
`docs/fusion/` (spec, domain model, glossary, ADR 0001-0019).

## Current Status: Usable Milestone Achieved

All four acceptance criteria from `docs/fusion/spec.md` ("Usable Milestone
Acceptance Criteria") were observed on this machine on 2026-07-05:

1. Default three-worker panel from a Claude Code parent (claude-code x1 +
   opencode x2), every worker `status: "ok"`, correct Markdown report.
2. Panel invoked from an OpenCode parent (`opencode run` with the bash tool
   executing the CLI) with a claude-code worker included, every worker
   `status: "ok"`.
3. `bun test` (28 pass), `bun run typecheck:fusion`, and `bun run schema:fusion`
   all green.
4. A `--record` run wrote the full split artifact set (8 files) under
   `.fusion-runs/<panelRunId>/`.

## What Exists Now

- `skills/fusion/bin/fusion-run.ts`: the bundled Bun CLI, the single canonical
  skill execution path (ADR 0014). Zero npm runtime dependencies; runs without
  `node_modules`. Markdown panel report on stdout by default, `--json` for the
  complete `PanelResult`. Exit code 0 for `ok`/`partial`, 1 for `failed`/usage
  errors.
- `skills/fusion/lib/panel-composition.ts`: default three-slot composition
  (parent model / `openai-flagship` / `budget-smart`), bundled alias table with
  ordered OpenAI-family and budget fallbacks, availability checks against
  `opencode models`, dedupe by resolved model ID with refill, and model-entry
  routing (`provider/model` → opencode, Claude aliases → claude-code,
  `opencode:`/`claude-code:` forced prefixes, unknown entries error) (ADR 0015).
- `skills/fusion/lib/headless-cli-adapters.ts`: both adapter bugs from the
  previous handoff are fixed and regression-tested. OpenCode parses
  `part.text` from `{"type":"text","part":{"type":"text","text":...}}` events
  (restricted to `part.type === "text"` so reasoning parts are not captured).
  Claude Code emits `--verbose`, `--tools=<comma-list>` (equals form), and
  `--fallback-model` from `ModelPreference.fallbacks`.
- Worker tool defaults include web: read-only local access plus
  WebSearch/WebFetch; edit/write/destructive/delegation tools denied (ADR 0018).
- Contract additions: `SynthesizerPreference`, `PanelRequest.synthesizer`,
  `PanelSpec.parentModel`; schemas regenerated (ADR 0016).
- Partial-failure defaults are OpenRouter-aligned: `allowPartial: true`,
  continue-and-disclose, `failed` only when every worker fails (ADR 0019).
- `skills/fusion/SKILL.md`: rewritten around the CLI path and parent-agent
  synthesis. Legacy execution tiers and hidden-subagent instructions are gone;
  the only internal path left is the emergency fallback, which must announce
  degraded status first (ADR 0017).

## Smoke Procedure (re-runnable)

These are manual checks with real, paid model invocations.

```bash
# Criterion 3: library validation (free)
bun test && bun run typecheck:fusion && bun run schema:fusion

# Criteria 1 + 4: default panel from a Claude Code parent, with recording.
# The parent agent passes its own model id as --parent-model.
bun skills/fusion/bin/fusion-run.ts --parent-model fable --record \
  --timeout-ms 240000 \
  "Return exactly the string: fusion-smoke-ok. Do not add any other text."
# Expect: Run status ok; workers claude-code x1 + opencode x2 all ok;
# 8 artifacts under .fusion-runs/<panelRunId>/ (request, manifest, events,
# worker-requests, worker-results, synthesis, compliance, result).

# Criterion 2: invocation from an OpenCode parent with a claude-code worker.
opencode run --model openai/gpt-5.5 'Use your bash tool to run this exact \
shell command from the current directory, wait for it to finish, then reply \
with only its "- Run status:" line and every "- Status:" line from stdout: \
bun skills/fusion/bin/fusion-run.ts --models sonnet,opencode/deepseek-v4-flash-free \
--timeout-ms 240000 "Return exactly the string: fusion-smoke-ok. Do not add any other text."'
# Expect: Run status ok; both workers ok.
```

`.fusion-runs/` must be git-ignored (it is, in the repo `.gitignore`); the file
recorder refuses to write otherwise without an explicit override.

## Known Limitations (honest state)

- Compliance tier is `degraded`, not `full`: the OpenCode CLI adapter cannot
  yet prove effective tool-policy enforcement, and neither adapter provides
  full session/tool-event evidence. Full compliance was not claimed for the
  usable milestone.
- The alias table (`openai-flagship`, `budget-smart`) pins current model IDs;
  generation changes are absorbed by editing
  `skills/fusion/lib/panel-composition.ts` in a skill update.
- `--synthesizer` accepts `parent-agent` (default) and `deterministic`;
  harness-kind values error as not implemented (contract-reserved).
- Forced per-worker harness routing travels through
  `harnessSelectionPolicy.userPolicy.fusionForcedHarnesses` because `PanelSpec`
  has no per-worker harness field; revisit if the portable contract grows one.
- The deterministic synthesis in the report is an audit reference; answer
  quality depends on the parent agent authoring the five-finding synthesis.

## Next Milestones (reserved)

1. Harness-backed judge: implement `--synthesizer <harness-kind>` as a separate
   worker invocation with its own provenance and evidence (ADR 0016).
2. CI automation of the smoke matrix (needs credential management and paid
   calls in CI; deferred by the acceptance criteria).
3. Stronger compliance evidence toward `full` tier: tool-policy proof for
   OpenCode workers, session/tool-event capture, SDK transports where they
   provide better evidence.
4. Consider removing the emergency internal fallback once the skill matures
   (ADR 0017).

## Useful Commands

```bash
bun test
bun run typecheck:fusion
bun run schema:fusion
bun skills/fusion/bin/fusion-run.ts --help
opencode models
```
