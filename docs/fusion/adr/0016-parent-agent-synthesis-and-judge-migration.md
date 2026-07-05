# ADR 0016: Parent-Agent Synthesis With Staged Judge Migration

## Status

Accepted

## Context

OpenRouter Fusion separates a judge call (a distinct temperature-0 model
invocation that produces the structured comparison) from the outer model that
writes the final answer. The portable contract already separates `synthesis`
from `finalAnswer` (ADR 0011), and ADR 0013 shipped a deterministic fallback
synthesizer as a stability mechanism, explicitly not the quality target.

For the usable milestone, adding a harness-backed judge call would grow the
implementation scope and add one model invocation of cost and latency to every
run.

## Decision

In the usable milestone, the parent agent authors the synthesis. The CLI
returns worker outputs plus evidence; `SKILL.md` directs the parent agent to
write the five-finding synthesis (consensus, contradictions, partial coverage,
unique insights, blind spots) and then the final answer grounded in it.

The CLI continues to emit the deterministic synthesis in the report and in
recorded artifacts as an audit reference and fallback, clearly labeled with its
strategy.

The synthesis ownership migrates in stages: parent agent now, harness-backed
judge later. The `--synthesizer` option contract is defined in this milestone
(strategy values such as `parent-agent`, `deterministic`, or a harness kind),
but only `parent-agent` and `deterministic` are implemented. The harness-backed
judge is the next synthesis milestone.

## Consequences

This diverges from OpenRouter Fusion, where the judge is a separate pinned
invocation: here the judge role and the final-answer role are both played by
the parent agent. The divergence is deliberate and recorded; synthesis quality
depends on the parent model, and judge independence is not claimed.

Because the parent-authored synthesis happens outside the CLI process, the
orchestrator records `synthesis.completed` for the deterministic reference
synthesis only; parent-authored synthesis is a skill-layer artifact until the
harness-backed judge exists.

No additional model invocation is charged to a default run.
