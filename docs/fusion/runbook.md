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

## Provisional candidate refresh (2026-09-05)

This is an ordered-candidate update under ADR 0015/0041, not a new selection
policy. The runtime table remains authoritative; inspect `--help` and
`--dry-run` rather than maintaining another copy of the fallback chains.

- Astra becomes the primary strong and OpenAI-flagship candidate. Sol remains
  a fallback, behind GLM-5.2 and DeepSeek V4 Pro in the strong pool so an Astra
  parent does not immediately select Sol when those alternatives are listed.
- Qwen3.8 Flash provisionally leads the efficient pool; previous candidates
  remain as fallbacks. This is a trial based on published pricing and privacy
  terms, not a measured quality or latency win over DeepSeek V4 Flash.
- GLM-5.2 stays: the [Go usage table](https://opencode.ai/docs/go/#usage-limits)
  currently lists identical token prices for GLM-5.2/5.3 but monthly usage
  equivalents of $60/$15 respectively. A newer name alone does not justify
  the quota trade-off.
- The [Go privacy table](https://opencode.ai/docs/go/#privacy), checked on this
  date, lists Qwen3.8 Flash as not used for training with zero-day retention.
  Go now has model-specific exceptions; ADR 0041's historical blanket-ZDR
  premise must not be used to admit additional models by provider prefix.
- Parent and judge defaults, explicit selection, and exact-ID deduplication
  are unchanged. Astra-fast can still coexist with Astra. No family-aware
  selection or runtime privacy gate is introduced by this refresh.

The design deliberation successfully invoked Astra, Fable 5.1, and DeepSeek
V4 Flash; it was not a candidate benchmark and did not invoke Qwen3.8 Flash.
Before treating the new order as validated, compare representative Fusion
outputs, success rates, elapsed time, and actual cost/quota against retained
candidates. Catalog presence and dry-run success alone do not establish these.

## DeepSeek candidate consolidation (2026-09-10)

Under ADR 0015/0041, consolidate the pools' V4 Pro/Flash candidates into
`opencode-go/deepseek-flash` (V4.1 Flash), keeping Astra/GLM/Qwen priorities.
[DeepSeek](https://api-docs.deepseek.com/news/news260910) redirects old Flash
IDs to V4.1 Flash and announces the same for Pro on September 14 at 04:00 UTC;
Go-side routing is unverified. This avoids retaining potentially equivalent
automatic candidates, without changing exact-ID deduplication or explicit IDs.
The [Go catalog/privacy table](https://opencode.ai/docs/go/) and local listing
confirm the new ID; Go lists no training use and ZDR through September 30, 2026
(monthly renewal). No live Fusion quality comparison was performed, so this
refresh does not establish superiority over Qwen or change selection policy.

## Notes

- `.fusion-runs/` must stay git-ignored; the file recorder refuses to
  write otherwise without an explicit override.
- Recorded run artifacts and probe job directories are machine-local
  evidence. The durable record of any decision they support is the ADR
  that cites them (the ADR 0042 principle).
