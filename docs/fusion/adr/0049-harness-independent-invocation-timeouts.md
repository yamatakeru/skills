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

### Stopping a harness process

A limit is only real if reaching it stops the work and returns. Claude Code and
Cursor run as CLI child processes, and previously a timeout sent SIGTERM and
then SIGKILL to that child alone. Descendants it had started (shells, hooks)
survived, and one that inherited the stdout pipe kept the invocation from
returning until it exited on its own; a local probe with a 300 ms limit
returned only after its 5-second descendant finished. OpenCode's interrupt API
stops session execution, but the owned `serve` process was stopped the same
way, and v2 servers do not trap SIGTERM, so their shell, LSP and MCP children
can be orphaned
([anomalyco/opencode#50780](https://github.com/anomalyco/opencode/issues/50780),
open for v2.0.14).

- Every harness process Fusion spawns (Claude Code and Cursor invocations, the
  owned OpenCode server) runs as the leader of its own process group.
- Stopping sends SIGTERM to the leader alone, giving a harness that cleans up
  its own children the chance to do so, then SIGKILLs whatever remains in the
  group after a 2-second grace period. The same sweep runs after a harness
  exits normally, so background processes it left behind do not outlive the
  invocation. After the sweep, pipes still held by a process outside the group
  are released so the invocation returns.
- For OpenCode, the session interrupt remains the first step; closing the
  server's stdin and the group stop follow at disposal.
- Because the groups no longer receive terminal-generated signals, runtime
  disposal stops every group still running, `fusion-run` and
  `fusion-judge-replay` run that disposal on SIGINT, SIGTERM and SIGHUP, and an
  abrupt process exit SIGKILLs the remaining groups.

Supervisor-side group cleanup stays correct once harnesses handle SIGTERM
themselves: the leader-first SIGTERM respects their own shutdown, and the
SIGKILL sweep still covers crashes, escalation and regressions. Two residuals
remain: a descendant that calls `setsid()` leaves the group, and Windows has no
process groups (the leader alone is signalled there). Full containment would
need OS facilities such as cgroups or job objects. If Fusion itself is killed
with SIGKILL, no cleanup runs; the OpenCode server still observes its closed
stdin.

### Live verification (2026-10-12)

Each run used one worker and the CLI's JSON output; harness processes present
after the run were compared with those present before it.

| Harness | Limit | Result | Returned after | Leftover processes |
| --- | --- | --- | --- | --- |
| Claude Code worker | 5,000 ms | `timeout` | 6,042 ms | none |
| Cursor worker (`composer-2.5-fast`) | 2,000 ms | `timeout` | 2,054 ms | none |
| OpenCode v2.0.26 worker | 5,000 ms | `timeout` | 9 s run incl. server startup | none |
| Claude Code judge, worker limit 120,000 ms | 3,000 ms | judge `timeout`, panel `ok` with parent-agent fallback warning | 3,975 ms | none |

## Consequences

- A default run can take roughly 15 minutes plus preparation. `SKILL.md`
  directs parent agents to start the CLI so that their own tool-call time
  limit cannot interrupt it before the panel report is written.
- Claude Code and Cursor workers are now bounded by default, and reaching the
  limit returns even when the harness left descendants behind. OpenCode
  workers get twice the previous default.
- Recorded runs created before this decision lack `judgeTimeoutMs`; replaying
  them uses the replay CLI's Judge Timeout default.
