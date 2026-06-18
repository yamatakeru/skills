This file is supplementary guidance for Fusion. The executable runtime protocol
remains in `../SKILL.md`. Do not rely on this file being read at runtime.

# Provenance

When `--record` is requested and safe, store enough information to audit the
panel decision without persisting secrets or unnecessary private data.

## Suggested Contents

- Original prompt and options.
- Panelist identifiers and model metadata when known.
- Each panelist's raw output.
- Structured synthesis.
- Final answer.
- Verification commands and results, if any.
- Degraded-mode notes, such as missing subagents or unavailable models.

## Suggested Location

Use `.fusion-runs/<timestamp>/` when the environment permits file writes.
Otherwise, mention that recording was requested but unavailable.
