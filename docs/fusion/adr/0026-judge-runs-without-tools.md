# ADR 0026: Judge Runs Without Tools — Deliberate Provisional Divergence

## Status

Accepted

Amends ADR 0024. Corrects the divergence inventory in ADR 0023.

Provisional by design: the infrastructure rationales below expire when the SDK
transport (reserved milestone 1) lands, and this decision does not renew
automatically — a re-decision is mandatory at that point (see Decision).

## Context

Upstream research (plugin, server-tool, and fusion-router docs, retrieved
2026-07-06 and independently re-verified by a recorded cheap-panel Fusion run
on the same day) established that upstream OpenRouter Fusion grants the judge
the same web tools as the panel:

> "The **judge** receives all panel responses, with `openrouter:web_search`
> and `openrouter:web_fetch` available, and compares them — it doesn't merge
> them." (plugin docs)

> "`openrouter:web_search` and `openrouter:web_fetch` are enabled on both the
> **panel** and the **judge** calls, so models can pull fresh sources while
> they answer and analyze." (server-tool and fusion-router docs)

Upstream also pins the judge's temperature: "The judge always runs at
temperature 0" (server-tool parameter table), and `max_tool_calls` (default 8,
range 1–16) applies to the judge's tool loop as well — upstream judge tools
are designed for multi-step use, not decoration. The server-tool surface is
marked beta ("The API and behavior may change").

ADR 0024 decided the judge runs with no tools, but its context did not record
the upstream judge tool grant, and ADR 0023's consequences listed only the
portable worker instructions (ADR 0020) and degraded compliance evidence
(ADR 0007/0022) as remaining divergences. The no-tools judge was therefore an
unrecorded divergence, decided without weighing upstream's actual judge
capability.

A recorded three-worker cheap-panel re-examination (gpt-5.5,
deepseek-v4-flash, grok-composer-2.5) unanimously recommended keeping the
no-tools judge for now under an explicit re-decision condition, judged the
reliability and enforcement rationales strongest, and unanimously rejected
framing no-tools as an analogue of upstream's temperature pin.

## Decision

The judge continues to run with no tools, uniformly across harnesses. The
divergence is deliberate, recorded, and provisional.

Standing rationales, classified by lifetime:

- Verification layering (architectural — persists beyond milestone 1). The
  judge's input, the task plus all completed worker outputs, is complete for
  the comparison job. The grounding role upstream's judge tools can serve is
  layered elsewhere in this runtime: mechanical substring verification of
  judge quotes (ADR 0024), then the parent agent's own read-tool verification
  before it authors the final answer. Hosted upstream cannot assume the
  calling model has tools; this runtime can, because `SKILL.md` requires the
  parent agent to verify load-bearing claims.
- Reliability asymmetry (infrastructure-bound — expires with milestone 1).
  The judge is a single synthesis-critical invocation on the serial critical
  path. Tool use through the current headless CLI adapters exposes it to the
  permission-abort dropout class that already fells panel workers (diagnosed
  2026-07-06; runtime handoff milestone 6). A worker dropout costs one panel
  seat; a judge dropout costs the entire structured analysis.
- Policy-enforcement asymmetry (infrastructure-bound — expires with
  milestone 1). The opencode adapter cannot enforce tool policy (ADR 0022); a
  tools-enabled judge routed there would degrade judge compliance evidence
  exactly where the system wants a clean comparison artifact.

Upstream's judge temperature pin is recorded honestly as an unmappable knob:
neither CLI harness exposes temperature, so the pin cannot be reproduced. It
is an accepted harness limitation like the unmapped budget knobs of ADR 0021
— not an argument for no-tools, which changes information access, not
sampling variance.

Re-decision duty: when the SDK transport provides programmatic permission
handling and effective, recordable judge tool policy, the infrastructure
rationales expire and this decision must be re-made rather than silently
extended. The re-decision is not automatic upstream-following — the
verification-layering rationale persists — and must be informed by a measured
tools-on/tools-off judge-quality comparison (reserved milestone 5
methodology). Measurement is a mandatory input, not a hard gate: the
evaluation criteria are designed in the comparison round, not fixed here.

Alternatives considered:

- Follow upstream now: rejected — reintroduces the judge dropout class and
  unenforceable tool policy on the current transport, on the one invocation
  whose failure forfeits the structured analysis.
- Split policy (tools only on a claude-code judge, where allowlist
  enforcement already works): rejected for the provisional period — judge
  capability would depend on model routing, making same-task runs
  non-comparable, muddying the future A/B, and adding contract complexity.
- Tool-free grounding (injecting worker-fetched sources, citations, and
  fetched content into the judge context instead of live tools): reserved as
  a candidate arm for the comparison round; it may capture part of the judge
  web-tool value without the reliability risk.

If judge tools are enabled later, the judge prompt must constrain them to
comparison support (validating uncertainty, classifying contradictions as
factual versus framing, filling blind spots) — never final-answer authorship
— and fetched-content prompt-injection mitigations must be designed first.

## Consequences

- The deliberate-divergence inventory is corrected to: portable worker
  instructions (ADR 0020), the no-tools judge (this ADR), and degraded
  compliance evidence (ADR 0007/0022).
- The judge cannot fact-check panel claims against fresh sources; a
  panel-wide shared error can surface as high-confidence consensus. That
  burden stays with the parent agent's mandatory verification step.
- The judge stays immune to the permission-abort dropout class until the SDK
  transport lands, keeping judge reliability decoupled from the adapter work.
- The re-decision duty is tied to observable milestones (SDK transport for
  the trigger, judge-quality comparison for the evidence) instead of being
  open-ended.
