# Fusion Runbook

Operational procedures for maintainers. This document is deliberately
non-normative and machine-specific: it names concrete harnesses, model
ids, and paid invocations, which the portable spec (`docs/fusion/spec.md`)
must not. The spec's acceptance criteria define WHAT is verified; this
runbook records HOW to re-execute the verification.

## Library validation (free)

```bash
bun test && bun run typecheck:fusion && bun run schema:fusion
```

## Live smoke: default panel (paid)

```bash
# Default panel from a Claude Code parent, with recording.
# The parent agent passes its own model id as --parent-model.
bun skills/fusion/bin/fusion-run.ts --parent-model fable --record \
  --timeout-ms 240000 \
  "Return exactly the string: fusion-smoke-ok. Do not add any other text."
```

Expect: Run status ok; workers claude-code x1 + opencode x2 all ok;
Judge ok with a validated "## Judge Analysis" section and zero warnings;
`result.json` carries `strategy` plus the structured analysis, no
`fallbackReason`; 8 artifacts under `.fusion-runs/<panelRunId>/`
(request, manifest, events, worker-requests, worker-results, synthesis,
compliance, result).

## Live smoke: OpenCode parent (paid)

```bash
opencode run --model openai/gpt-5.5 'Use your bash tool to run this exact \
shell command from the current directory, wait for it to finish, then reply \
with only its "- Run status:" line and every "- Status:" line from stdout: \
bun skills/fusion/bin/fusion-run.ts --models sonnet,opencode/deepseek-v4-flash-free \
--timeout-ms 240000 "Return exactly the string: fusion-smoke-ok. Do not add any other text."'
```

Expect: Run status ok; both workers ok.

## Live smoke: gated test suite (paid)

Fragile-surface monitors (ADR 0034/0045 fragility registers) run as
env-gated bun tests and never touch real user configs:

```bash
cd skills/fusion
FUSION_LIVE_TESTS=1 bun test test/live-instruction-environment-smoke.test.ts
FUSION_LIVE_TESTS=1 bun test test/live-watchdog-smoke.test.ts
```

Expect: all legs pass (instruction-environment: claude scratch-cwd
marker pair blocked/detected, opencode populated/blocked redirect pair).

## Preflight without spending

```bash
bun skills/fusion/bin/fusion-run.ts --parent-model fable --dry-run \
  --models <entries> "<task>"
```

Exit 0 iff the composition resolves cleanly (ADR 0036).

## Useful commands

```bash
bun skills/fusion/bin/fusion-run.ts --help
opencode models
cursor-agent models
```

## Notes

- `.fusion-runs/` must stay git-ignored; the file recorder refuses to
  write otherwise without an explicit override.
- Recorded run artifacts and probe job directories are machine-local
  evidence. The durable record of any decision they support is the ADR
  that cites them (the ADR 0042 principle).
