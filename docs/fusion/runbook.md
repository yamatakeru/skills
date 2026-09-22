# Fusion Runbook

Operational procedures for maintainers. This document is deliberately
non-normative and machine-specific: it names concrete harnesses, model
ids, and paid invocations, which the portable spec (`docs/fusion/spec.md`)
must not. The spec's acceptance criteria define WHAT is verified; this
runbook records HOW to re-execute the verification.

## Library validation (free)

```bash
env -u FUSION_LIVE_TESTS bun test
bun run typecheck:fusion
# Only after portable contract types change:
bun run schema:fusion
```

## OpenCode v2 reference environment

Target: `opencode v2.0.12`; supported boundary: stable 2.0.x >= 2.0.12.
The v1 adapter and OpenCode CLI transport are removed (ADR 0046). The pinned
`@opencode/client` dependency is type-only; the installed skill needs no npm
runtime packages. Use SDK transport for OpenCode workers and judge.

Free contract check (real owned server, `resume:false`, **no model calls**):

```bash
opencode --version
bun test skills/fusion/test/opencode-containment.integration.test.ts
```

It checks authentication, actual server identity, native effective permissions,
parked prompt admission, interrupt, and owned process shutdown. Missing or
unsupported OpenCode skips this real-binary test; adapter fixtures still test
explicit version rejection. The v2 model catalog may differ from v1: inspect
`opencode models` rather than assuming a formerly listed id remains present.
For example, the 2.0.12 catalog listed `opencode-go/deepseek-v4.1-flash`, not the
previous candidate alias `opencode-go/deepseek-flash`. This migration does not
change the model candidate policy.

OpenCode web search uses owner-approved run-scoped Exa selection. No user-global
provider choice is written, and a failed provider is not silently replaced.
Without explicit selection, v2.0.12's first-use form can wait one minute then
return `Web search cancelled` even though permissions allow the tool.

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
bun skills/fusion/bin/fusion-run.ts --models sonnet,opencode-go/deepseek-v4.1-flash \
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
To restrict paid calls to OpenCode's two instruction-environment legs:

```bash
FUSION_LIVE_TESTS=1 FUSION_LIVE_MODEL=opencode-go/deepseek-v4.1-flash \
  bun test skills/fusion/test/live-instruction-environment-smoke.test.ts \
  --test-name-pattern OpenCode
```

Run this last command from the repository root. `FUSION_LIVE_MODEL` overrides
the OpenCode model only. These tests use synthetic markers and scratch config
directories, not real instruction contents. Budget model calls explicitly;
normal validation must leave `FUSION_LIVE_TESTS` unset.

## Preflight without spending

```bash
bun skills/fusion/bin/fusion-run.ts --parent-model fable --dry-run \
  --models <entries> "<task>"
```

Exit 0 iff the composition resolves cleanly (ADR 0036). This does not check
runtime server identity or effective permissions. On v2 `opencode models` may
start a shared background service during dry-run; empty successful catalogs are
retried within a bounded window. Fusion's execution server is separate, and
Fusion does not terminate the shared catalog service.

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

## GPT-6 Sol/Luna candidate refresh (2026-09-23)

Under ADR 0015/0041, refresh the runtime alias table using the
[OpenAI announcement](https://openai.com/index/introducing-gpt-6-sol-and-luna/)
and model specifications for
[Sol](https://developers.openai.com/api/docs/models/gpt-6-sol) and
[Luna](https://developers.openai.com/api/docs/models/gpt-6-luna). Standard input /
output prices per million tokens are $2 / $10 for Sol and $0.10 / $0.50 for Luna.
These are provider-published capabilities and prices, not a Fusion benchmark.

- Replace GPT-5.6 Sol/Luna with GPT-6 Sol/Luna. Remove older OpenAI candidates
  from automatic pools and the compatibility flagship alias: the owner uses
  the current catalog and does not need previous-generation fallbacks.
- Retain the existing Astra/GLM/DeepSeek and Qwen priorities. The announcement
  does not establish a Fusion quality or latency win over the other families.
- Correct both pools' DeepSeek entry to `opencode-go/deepseek-v4.1-flash`:
  `opencode models` lists this ID, not the former `deepseek-flash` alias.
- The local catalog and explicit Sol/Luna dry-run resolve both new models.
  No live quality comparison was performed. Explicit older model IDs remain
  usable when the harness lists them.

## OpenCode v2 migration validation (2026-09-21–22)

The owner authorized at most ten live sessions. Exactly ten were used, all on
`opencode-go/deepseek-v4.1-flash`; no further paid run is implied by this record.
The decision and decisive observations are preserved in ADR 0046, independently
of temporary files and local `.fusion-runs/` artifacts.

| Sessions | Scratch-only test | Result |
|---|---|---|
| 1 | Workspace and declared-root read, undeclared-root rejection, allowed `ls`, synthetic project AGENTS marker | All observed; configured denial did not drop the worker |
| 2–3 | Populated config redirect positive control / empty adapter redirect negative control | Both passed |
| 4–5 | Recorded worker with glob/grep/read/webfetch/websearch, then no-tools judge | Worker and judge JSON succeeded; unselected websearch failed at consent timeout, correctly recorded as tool failure |
| 6 | Inject `read: ask` into the fresh scratch session immediately before prompt to exercise an unexpected ask | Reject with feedback, one attributed denial, model continued with `DENIAL_OBSERVED` |
| 7 | Same adapter after owner-approved run-scoped Exa selection | Websearch succeeded and cited IANA example-domains |
| 8–9 | Two independent workers, identical prompt/model, deterministic synthesis, `--record` | Both `ok`, distinct sessions, `full`, clean watchdog, successful interrupts, nine base artifacts and `run-status: complete` |
| 10 | Long-output prompt with 5-second worker budget | Expected `timeout`; active session before interrupt, `interrupted:true`, empty active set afterward, owned server unreachable after disposal |

Reproduce the parallel-recording leg from a **scratch Git repository** with
`.fusion-runs/` ignored and a `fact.txt` containing `The fixture number is 42.`.
Use an absolute skill path because the working directory is the fixture:

```bash
bun <skill-dir>/bin/fusion-run.ts \
  --models opencode-go/deepseek-v4.1-flash,opencode-go/deepseek-v4.1-flash \
  --synthesizer deterministic --record --json --timeout-ms 30000 \
  'Read fact.txt with the read tool. Report the fixture number in the required sections, in fewer than 100 words. Do not use any other tools.'
```

For timeout instrumentation, wrap the adapter's authenticated fetch: immediately
before forwarding `/interrupt`, query `/api/session/active`; clone the interrupt
response and query active sessions again afterward. Use one fresh scratch worker,
a long-output/no-tools prompt, and `budget.timeoutMs: 5000`. Assert prompt
admission, actual activity before interrupt, inactivity after it, result
`timeout`, successful `abortOutcome`, then server unreachability after dispose.
This distinguishes remote stopping from merely disconnecting the client. For
the unexpected-ask leg, PATCH only the scratch session's `permissions` to
`[{action:"read",resource:"*",effect:"ask"}]` immediately before prompt; this
narrows access and deliberately exercises the normally unused approval path.
Never change a real user session or bypass the startup verifier in production.

Edit/write/subagent/unknown-action denials were checked through the actual native
permission evaluator without a model and through fixtures, not by attempting
destructive operations or spawning live subagents. Stream corruption and other
failure combinations have fixture coverage. This is a transport/safety smoke,
not a quality benchmark or a rerun of the full cross-harness milestone matrix.

## Notes

- `.fusion-runs/` must stay git-ignored; the file recorder refuses to
  write otherwise without an explicit override.
- Recorded run artifacts and probe job directories are machine-local
  evidence. The durable record of any decision they support is the ADR
  that cites them (the ADR 0042 principle).
