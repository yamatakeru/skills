This file is supplementary guidance for Council. The executable runtime
protocol remains in `../SKILL.md`. Do not rely on this file being read at
runtime.

# Provenance

When `--record` is requested and safe, store enough information to audit the
review without persisting secrets or unnecessary private data.

## Suggested Contents

- Original prompt and options.
- Role identifiers and model metadata when known.
- Each role's raw output.
- Structured synthesis.
- Final answer.
- Verification commands and results, if any.
- Degraded-mode notes, such as missing subagents or unavailable models.

## Suggested Location

Use `.council-runs/<timestamp>/` when the environment permits file writes.
Otherwise, mention that recording was requested but unavailable.
