# ADR 0025: Usage Criteria — Comparison-Shaped Tasks and Stakes-Matched Panels

## Status

Accepted

## Context

The skill previously scoped Fusion to "ambiguous, high-stakes, open-ended, or
explicitly requested" tasks. That tone was inherited from the pre-runtime
prompt-based skill and matches upstream OpenRouter Fusion's selective usage
guidance (retrieved 2026-07-05): "research questions, multi-domain critique,
'compare and contrast' prompts, or anything where being wrong is expensive",
with the cost warning "With the default 3-model panel, expect roughly 4–5×
the cost of a single completion on the same prompt."

Evidence gathered on 2026-07-05 challenged stakes-only gating:

- OpenRouter's DRACO benchmark (100 deep-research tasks): "A budget panel
  (Gemini 3 Flash, Kimi K2.6, and DeepSeek V4 Pro) came within 1% of
  Fable 5's score while being 50% of the cost." The budget panel (64.7%)
  outscored solo Opus 4.8 (58.8%) and solo GPT-5.5 (60.0%); the Quality
  preset (Fable 5 + GPT-5.5) "scored 69.0%, surpassing every individual
  model". Roughly three quarters of the synergy is attributed to the judge.
- Upstream's cost warning is framed for per-token API billing. This
  deployment's economics differ: non-Claude harness subscriptions carry loose
  usage limits (cheap workers in daily use at xhigh effort without quota
  pressure), while Claude-family quota is the scarce resource.
- Two recorded dogfooding panels deliberated this policy, and a head-to-head
  run of the same brief against a single Opus pass showed the single pass
  winning on a narrow policy-wording task — the task shape, not the stakes,
  predicted which tool won.

## Decision

The Fusion usage criterion is task shape, matched to panel composition by
stakes:

- Use Fusion for comparison-shaped tasks: work where independent perspectives
  are likely to change or sharpen the conclusion (deep research, design
  exploration, review-angle sweeps, contested second opinions). Trivial or
  narrow tasks remain outside panel execution (reaffirming ADR 0017).
- Match the panel to the stakes: cheap-model panels may be used casually for
  exploratory comparison-shaped work; flagship-mixed panels are reserved for
  high-stakes or hard-to-reverse decisions.
- Work whose deliverable is a single authored voice, language-sensitive
  nuance, or a latency-bound read stays outside Fusion; a single strong pass
  serves it better than judge-stitched consensus.
- The portable `SKILL.md` carries the shape-plus-stakes framework without
  deployment-specific subscription claims; deployment economics live in the
  local orchestrator policy (`CLAUDE.md` / `AGENTS.md`).

This deliberately diverges from upstream's selective usage tone. The
divergence is economic, not architectural: where marginal panel cost is
negligible, stakes-only gating discards quality that DRACO shows cheap panels
deliver on breadth-bound work.

## Consequences

- `SKILL.md` (description and When-to-Use) and the local `CLAUDE.md`
  delegation policy are rewritten around comparison shape and stakes-matched
  panels; the glossary gains "Comparison-Shaped Task".
- Casual cheap panels raise exposure to cheap-worker dropouts. Existing
  partial-run disclosure semantics are the mitigation; the OpenCode adapter
  invalid-output investigation is tracked in the runtime handoff.
- The recorded-divergence list grows: usage tone (this ADR) joins portable
  worker instructions (ADR 0020) and degraded compliance evidence
  (ADR 0007/0022).
- The framework is operational guidance and cheap to revise. Revisit triggers:
  observed over-panelization in real use, subscription economics changing, or
  upstream publishing usage guidance that contradicts the shape-based
  criterion.
