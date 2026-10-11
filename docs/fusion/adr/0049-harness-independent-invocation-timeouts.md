# ADR 0049: Harness-Independent Worker and Judge Timeouts

## Status

Accepted. Partially supersedes ADR 0023's clause that the panel-wide
`--timeout-ms` applies to the judge invocation. ADR 0023's other judge
decisions, including shared `ReasoningPreference`, remain unchanged.

## Context

Before this decision, Fusion had no harness-independent timeout default. The
only `--timeout-ms` value was optional and shared by workers and the judge.
When it was omitted, the effective limit depended on the adapter: the OpenCode
SDK adapter fell back to 300 seconds, while the Claude Code, Cursor and headless
CLI adapters set no timer at all. No spec or ADR recorded a reason for that
split; it followed from OpenCode needing an abort deadline for its session.

In practice, panels frequently reported "N of M workers timed out". Workers
run multi-turn, tool-using investigations; the judge compares already returned
outputs without tools. A single shared value was therefore sized for workers
and left the judge with the same, unrelated limit, while an unset value meant
either 5 minutes or unbounded depending on the harness.

## Decision

- Fusion has two invocation limits, both harness-independent and always
  bounded:
  - **Worker Timeout**: default 600,000 ms (10 minutes), set with
    `--worker-timeout-ms`.
  - **Judge Timeout**: default 300,000 ms (5 minutes), set with
    `--judge-timeout-ms`, independent of the Worker Timeout. It does not
    inherit the worker value.
- Each limit is the wall-clock time of one invocation, from dispatch to result.
  Shared preparation reused across invocations, such as starting a pooled
  OpenCode server, is excluded.
- There is no unbounded mode. A hang must surface as a disclosed dropout (or,
  for the judge, as fallback to parent-agent synthesis); a caller that needs
  more time passes a larger value.
- Only the timeout is split. `--max-turns` and `ReasoningPreference` remain
  shared between workers and the judge, as in ADR 0023; the no-tools judge has
  no use for a separate turn budget.
- Defaults are resolved in the runtime library, not in individual adapters.
  Worker requests always carry the effective Worker Timeout, judge requests the
  effective Judge Timeout, and adapters fall back to the shared Worker Timeout
  constant for a request without a budget. The OpenCode-specific 300-second
  fallback is removed.
- `PanelRequest.judgeTimeoutMs` carries the Judge Timeout. The CLI writes both
  effective values into the panel request, so recorded runs disclose them, and
  the dry-run report shows them.
- `--timeout-ms` is removed from `fusion-run` and renamed to
  `--judge-timeout-ms` in `fusion-judge-replay`, whose default moves from
  600,000 ms to the Judge Timeout default so replays judge under production
  conditions. Passing the old flag fails with a usage error that names the
  replacement, because agents tend to repeat invocations from earlier
  transcripts and run records. `--judge-timeout-ms` with a non-judge
  synthesizer is a usage error, like `--judge-model`.

## Consequences

- A default run can take roughly 15 minutes plus preparation. `SKILL.md`
  directs parent agents to start the CLI so that their own tool-call time
  limit cannot interrupt it before the panel report is written.
- Claude Code, Cursor and headless CLI workers are now bounded by default.
  OpenCode workers get twice the previous default.
- Recorded runs created before this decision lack `judgeTimeoutMs`; replaying
  them uses the replay CLI's Judge Timeout default.
