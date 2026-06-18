This file is supplementary guidance for Fusion Council. The executable runtime protocol remains in `../SKILL.md`. Do not rely on this file being read at runtime.

# Provenance Guidance

Provenance is optional. Record it only when the user requests it, the environment permits it, and it is safe to persist the task content.

## Suggested Directory

Use `.fusion-runs/` when file writes are allowed:

```text
.fusion-runs/
  <timestamp-or-run-id>/
    prompt.md
    metadata.json
    participant-outputs.md
    synthesis.md
    final.md
    verification.md
```

## Metadata

Useful metadata includes:

- timestamp or run id
- mode: `blind`, `council`, or `auto`
- panelist count or selected roles
- model slugs or model configuration when known
- tool availability and permission limits
- failed, skipped, or timed-out participants
- verification commands and results
- degraded mode notes

## Safety

- Do not persist secrets, credentials, tokens, or unnecessary private data.
- Do not record if the user asks not to.
- Treat prompts and model outputs as potentially sensitive.
- If provenance could not be recorded, say so in the final answer when relevant.

## When It Helps

Provenance is most useful for high-stakes architecture decisions, security reviews, expensive migrations, compliance-sensitive work, and debugging the council process itself.
