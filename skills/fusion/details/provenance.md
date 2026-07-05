This file is supplementary guidance for Fusion. The executable runtime protocol
remains in `../SKILL.md`. Do not rely on this file being read at runtime.

# Provenance

When `--record` is requested and safe, store enough information to audit the
panel decision without persisting secrets or unnecessary private data.

## Suggested Contents

- Original prompt and options.
- Panelist identifiers and model metadata when known.
- Each panelist's returned structured output, excluding private
  chain-of-thought and full reasoning traces.
- Concise reasoning summaries, evidence, sources, tool-result references,
  assumptions, uncertainties, and verification notes when provided.
- CLI deterministic audit synthesis.
- Parent-authored synthesis and final answer, if separately captured by the
  parent agent.
- Verification commands and results, if any.
- Degraded-mode notes, such as CLI fallback use or unavailable models.

## Suggested Location

Use `.fusion-runs/<timestamp>/` when the environment permits file writes.
Otherwise, mention that recording was requested but unavailable.
