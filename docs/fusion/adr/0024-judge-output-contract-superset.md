# ADR 0024: Judge Output Contract — Upstream Core Plus Optional Extensions

## Status

Accepted

Amended by ADR 0026: the no-tools judge decision below is now recorded as a
deliberate, provisional divergence — upstream grants the judge the panel's
web tools, a fact this ADR's context did not record.

Amended by ADR 0027: this ADR's upstream schema description was inaccurate —
upstream `partial_coverage` and `unique_insights` items carry model
attribution, not plain strings — and core validation now accepts the
documented upstream shapes so the fidelity consequence below holds.

## Context

Upstream OpenRouter Fusion publishes the judge's output schema (server-tool
docs, retrieved 2026-07-05): a structured JSON object with five keys —
`consensus`, `contradictions` (objects with `topic` and `stances`),
`partial_coverage`, `unique_insights`, `blind_spots` — where consensus items
are "treated as higher-confidence". Only `contradictions.stances` carries
model attribution; the other four sections are plain string arrays.

Our `SynthesisContract` already requires the same five findings and has
`requireAttribution: true`, which the upstream schema alone cannot enforce
outside contradictions. A local implementation can also verify judge honesty
mechanically in a way the hosted upstream does not expose: verbatim quotes
from worker outputs can be checked by substring match against the actual
worker outputs the runtime holds.

Alternatives considered for the judge schema:

- Strict upstream schema: maximum fidelity, but attribution stays
  unenforceable and no grounding check is possible.
- Mandatory extended schema: strongest verification, but every extra required
  field raises validation-failure (and therefore judge-fallback) rates across
  heterogeneous models driven through CLI harnesses.
- A judge-proposed resolution field (which stance is right): rejected — it
  breaks upstream's core design ("compares them — it doesn't merge them") and
  pushes the judge toward answer authorship, eroding the multi-perspective
  benefit.

## Decision

The judge output contract is a superset of the upstream schema:

- Validation requires exactly the upstream five-key core structure.
  Extraction is tolerant (code fences stripped) before schema validation;
  a response that fails core validation is a judge failure and triggers the
  ADR 0023 fallback semantics.
- The judge prompt additionally requests two optional, additive extensions:
  worker attribution on items in all five sections, and verbatim supporting
  quotes from worker outputs. Missing extensions never fail validation.
- When quotes are present, the runtime verifies each by substring match
  against the attributed worker's output; mismatches produce warnings, not
  failures, and are recorded.
- No resolution or verdict field exists: the judge compares, it does not
  decide the answer.
- The judge runs with no tools. Its input (task plus all worker outputs) is
  complete for the comparison job; claim verification is layered instead as
  runtime quote matching plus the parent agent's own read-tool verification
  before it writes the final answer.
- The judge analysis is stored as structured JSON in `PanelResult` and
  recorded artifacts, and rendered to a Markdown section in the panel report.

## Consequences

- Fidelity to upstream is preserved at the validation boundary: any output a
  faithful upstream judge would produce passes.
- `requireAttribution` becomes mechanically checkable when the judge
  cooperates, and judge fabrication (hallucinated consensus) becomes
  detectable through quote mismatch warnings — a verification axis the hosted
  upstream does not offer.
- Because extensions are optional, weaker judge models degrade to the plain
  upstream schema instead of inflating fallback rates.
- The report renderer and schema generation gain a `JudgeAnalysis` structure
  that must stay aligned with the upstream schema if upstream changes; that
  drift risk is accepted and absorbed by skill updates, like the model alias
  table.
