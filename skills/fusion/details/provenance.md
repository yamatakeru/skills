# Provenance

Read this when you need a run's artifacts: to audit a panel, inspect worker
tool evidence, or recover a run whose synthesis was lost.

## Recorded artifacts

`--record` writes these files under `.fusion-runs/<panelRunId>/` in the
current workspace:

- `run-status.json`: run state (below).
- `request.json`: the panel request, including the resolved options.
- `manifest.json`: the shared-context manifest.
- `events.jsonl`: the run's event log.
- `worker-requests.json` and `worker-results.json`: each worker's request and
  result, including `toolUseSummary.deniedRequests` and
  `complianceEvidence.notes`.
- `synthesis.json`: the judge analysis or the deterministic audit synthesis.
- `compliance.json`: the compliance evaluation.
- `result.json`: the full `PanelResult`.

Recording requires `.fusion-runs/` to be listed in the workspace
`.gitignore`. Otherwise recording is refused with a warning and the panel
still runs unrecorded. Secret-like keys and values are redacted. Private
chain-of-thought is never recorded.

## Run status

Worker requests and results are written incrementally, so they survive a
later synthesis or process failure. `run-status.json` reads:

- `running`: the run started but did not reach a handled terminal state, for
  example after `SIGKILL`;
- `complete`: the run finalized normally;
- `failed`: the run finalized with failure;
- `aborted`: `SIGINT` or `SIGTERM` was handled and the run finalized
  best-effort.

## Judge replay

When a recorded run's worker artifacts survived, rerun only the judge:

```bash
bun <skill-dir>/bin/fusion-judge-replay.ts \
  --run <id-or-path> --arm recovery --judge-model <entry>
```

Replay writes `synthesis-replay-<arm>.json` and
`replay-manifest-<arm>.json` next to the original artifacts and leaves them
unchanged. It recovers synthesis; it does not make the original run-status
evidence that the original process completed. `--help` lists the remaining
options.
