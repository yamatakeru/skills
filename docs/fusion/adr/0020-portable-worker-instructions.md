# ADR 0020: Portable Worker Instructions Adopt OpenCode Panelist Norms

## Status

Accepted

## Context

The usable-milestone runtime wrapped the task prompt with suppression-only
instructions ("return only the requested answer", "no hidden
chain-of-thought") and nothing else. Observed panels investigated noticeably
less than the original OpenCode subagent Fusion.

A three-way comparison established the causes:

- Upstream OpenRouter Fusion sends panelists the raw user prompt with no
  harness-added instructions; investigation depth is each model's native
  tool-use behavior inside a bounded tool-call budget.
- The original OpenCode subagent version gave panelists a neutral-panelist
  norm set (independence, no coordination, one strong answer, explicit
  tool-use encouragement, uncertainty preservation) plus required output
  sections that force evidence surfacing. Its reasoning-effort settings were
  all commented out, so effort was never the differentiator.
- The current runtime rendered neither the norms nor the output contract,
  even though the glossary already defines the Rendered Prompt as "user task,
  portable worker instructions, and output contract". The implementation also
  rendered the prompt inside each adapter and hashed only the raw task string
  in the `ContextManifest`, so the manifest did not prove rendered-prompt
  identity.

## Decision

The portable worker instructions are a port of the OpenCode panelist norms:
neutral independent panelist framing, no coordination with or speculation
about peers, one strong self-contained answer rather than hedging for a
judge, tool use encouraged when it materially improves correctness (primary
sources for research, project-local evidence for code), no file modification,
uncertainty preserved with the evidence that would resolve it, and concise
reasoning summaries instead of hidden chain-of-thought.

The required output sections are a single generic set rendered from
`OutputContract.requiredSections`; they are not hardcoded in the prompt
template and not forked by task type.

Prompt rendering moves out of the harness adapters into the orchestrator
layer: worker requests carry the fully rendered prompt, adapters send
`request.prompt` verbatim, and the `ContextManifest` hashes the actual
rendered prompt.

This deliberately diverges from upstream OpenRouter Fusion, which adds no
instructions at all. The divergence is a provisional trade-off: Fusion here
runs inside local agentic harnesses where suppression-only prompts measurably
reduced investigation, and the OpenCode norms are the proven local
adaptation. The policy may be revisited (including toward upstream
minimalism) as evidence accumulates.

## Consequences

Rendered prompts become identical across harnesses by construction, and the
manifest can prove it. Worker outputs regain the evidence-forcing sections
("key evidence", "what I would verify next") that reward investigation.
Fidelity to upstream prompt minimalism is knowingly sacrificed and must be
re-evaluated rather than treated as settled.
