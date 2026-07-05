# ADR 0027: Judge Core Validation Accepts Documented Upstream Shapes

## Status

Accepted

Amends ADR 0024: corrects its upstream schema description and restores its
stated fidelity property at the validation boundary.

Implementation pending as of 2026-07-06 (see the runtime handoff).

## Context

ADR 0024's context described the upstream judge schema as "plain string
arrays" outside `contradictions`, and its consequences claimed that "any
output a faithful upstream judge would produce passes" local validation.
Re-verification against the upstream docs (2026-07-06, three official pages,
independently confirmed by a recorded cheap-panel run) shows the current
upstream example is richer:

```json
"analysis": {
  "consensus": ["..."],
  "contradictions": [{ "topic": "...", "stances": [{ "model": "...", "stance": "..." }] }],
  "partial_coverage": [{ "models": ["..."], "point": "..." }],
  "unique_insights": [{ "model": "...", "insight": "..." }],
  "blind_spots": ["..."]
}
```

`partial_coverage` items carry `models` + `point`, and `unique_insights`
items carry `model` + `insight` — structured objects with model attribution,
not plain strings. The current validator (`judge-analysis.ts`) accepts only
strings or `{ text }` objects in finding sections, so a faithful
upstream-shaped output hard-fails core validation and triggers the ADR 0023
judge-failure fallback, forfeiting the structured analysis. Contradiction
stances shaped `{ model, stance }` pass, but the `model` attribution is
silently dropped. ADR 0024's fidelity property therefore does not hold today.
The failure is latent in default runs — our judge prompt embeds a JSON
skeleton in our own shape — but models that imitate the published upstream
docs are penalized exactly for being faithful.

## Decision

Judge core validation additionally accepts exactly the documented upstream
item shapes, and nothing more:

- `partial_coverage` items `{ models: string[], point: string }` normalize to
  the internal finding with `text: point` and best-effort attribution.
- `unique_insights` items `{ model: string, insight: string }` normalize to
  the internal finding with `text: insight` and best-effort attribution.
- contradiction stances `{ model: string, stance: string }` keep the stance
  and promote `model` to best-effort attribution instead of dropping it
  silently.

Best-effort attribution resolves upstream model names against the panel's
`WorkerResult.modelUsed` values, which the parser already receives. An
unresolvable or ambiguous model name degrades to the unattributed form with a
warning, never a validation failure — attribution is an optional extension
per ADR 0024, so losing it is contract-legal; losing it silently is not.

The acceptance set is exactly "our skeleton shapes ∪ the documented upstream
shapes". Any other object shape in a finding section remains a hard
validation failure: the goal is restoring ADR 0024's fidelity property, not
general leniency, and the strict boundary is what keeps the five-key
semantics meaningful. The judge prompt's JSON skeleton is unchanged — we
still request our own shapes; this decision is about what we accept.

`JudgeAnalysis` types are unchanged (normalization targets the existing
internal shapes), so no schema regeneration is expected; the schema check
runs as a no-diff verification.

## Consequences

- ADR 0024's stated property — a faithful upstream judge output passes —
  becomes true again, and this ADR is the template for absorbing future
  upstream schema drift (the risk ADR 0024 accepted).
- Upstream-shaped attribution survives normalization when model names map
  cleanly onto panel workers; otherwise the analysis stays valid with a
  disclosed warning.
- The strictness boundary is preserved and now precisely defined, so
  validation failures keep signaling judge non-compliance rather than schema
  drift.
- Quote verification and rendering are unaffected: normalization happens
  before both, targeting the existing internal types.
