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
- `run-status.json`, written as `running` when recording begins and resolved to
  `complete`, `failed`, or `aborted` on handled terminal paths.

## Suggested Location

Use `.fusion-runs/<timestamp>/` when the environment permits file writes.
Otherwise, mention that recording was requested but unavailable.

## Crash Marker and Judge Replay

Recorded artifacts are written incrementally so worker requests and results
survive a later synthesis or process failure. `run-status.json` has these
semantics:

- `running`: the run started but did not reach a handled terminal state;
- `complete`: the run finalized normally;
- `failed`: the run finalized with failure;
- `aborted`: a handled interrupt or termination finalized best-effort.

`SIGINT` and `SIGTERM` handlers attempt to write `aborted`. `SIGKILL` cannot be
handled, so the marker remains `running` and makes the crash self-describing.

When the required worker artifacts exist, recover synthesis without rerunning
workers by using judge replay:

```bash
bun skills/fusion/bin/fusion-judge-replay.ts \
  --run <id-or-path> \
  --arm recovery \
  --judge-model <entry>
```

Replay writes separate judge artifacts and preserves the original run evidence.
