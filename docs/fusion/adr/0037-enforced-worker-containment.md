# ADR 0037: Enforce Worker Containment at the Harness Boundary

## Status

Accepted

Amends ADR 0022 and ADR 0029.

## Context

Issue #10 exposed a self-overwriting permission configuration in the OpenCode
SDK adapter. The adapter correctly injected a fine-grained permission map for
the `fusion-worker` agent, but each prompt also sent the deprecated prompt-body
`tools` field. OpenCode converted that field to a coarse session permission and
replaced `session.permission` wholesale, so the adapter's own `bash` allowlist
and deny rules disappeared. ADR 0022's statement that the OpenCode adapter
cannot enforce tool policy is therefore obsolete for the SDK transport: the
adapter can enforce it, but this conflicting prompt field defeated that
enforcement.

The incident also showed that ending the local event stream did not stop the
remote session. The worker produced a final answer, continued running until the
shared server was killed, and performed the mutations that the overwritten
permission map should have denied.

## Decision

The OpenCode SDK adapter removes the deprecated prompt-body `tools` field. Its
agent permission map is deny-by-default: a catch-all `"*": "deny"` rule is
inserted first, followed by explicit allows for `read`, `grep`, `glob`, and
`list`, the declared web tools and read roots, and the command-level read-only
`bash` allowlist. The nested `bash` map also denies `"*"` before its explicit
command allows. Unknown MCP, plugin, task, and dynamically named tools therefore
fall through to deny instead of inheriting a harness default.

After the server starts, the adapter reads the agent's effective rules and
asserts the minimum containment invariants: the top-level catch-all deny, the
`bash` catch-all deny, and the expected explicit allows. A mismatch is a
detected defense failure and fails fast. No model is invoked on that server;
its workers return structured failures, while the panel may continue to partial
synthesis under ADR 0008 and ADR 0019.

Every terminal session path performs explicit cleanup. After collecting a
result, or on timeout or error, the adapter requests session abort before
disconnecting the event stream. Abort failure is warning-only and is recorded
as evidence; it does not retroactively fail the worker. The asymmetry is
intentional: a known startup defense failure would knowingly launch an
uncontained model and must stop execution, whereas an abort failure happens
after execution and is a cleanup failure that can only be disclosed and handed
to server shutdown as the final backstop.

`experimental.continue_loop_on_deny: true` remains enabled while OpenCode
supports it. It is the implementation component of ADR 0029's permission
pre-decision semantics: a denial becomes visible degradation that the worker
can explain, rather than a worker dropout. It played no role in issue #10
because the overwritten rules produced no denials.

Both CLI entrypoints, `fusion-run` and `fusion-judge-replay`, enforce a process
recursion guard. Adapters increment the numeric `FUSION_PANEL_DEPTH` environment
variable in worker spawn environments, and either entrypoint refuses to start
when the inherited depth is at least one. This is defense in depth: the default
`bash` allowlist already excludes `bun`, so permission enforcement normally
blocks nested Fusion first. The guard becomes the independent boundary if that
allowlist is later loosened or a worker is deliberately run with full tools.

## Consequences

The SDK transport's tool policy is now an enforced harness boundary rather than
a prompt convention, and startup verification prevents a detected regression
from reaching a model. ADR 0022's degraded statement remains true only for the
explicit OpenCode CLI transport, which still cannot enforce or prove the tool
policy.

Denials remain recoverable worker-visible events, terminal sessions are
explicitly aborted, and nested panel entry is rejected independently of prompt
obedience. None of these controls makes the `bash` allowlist a complete
write-prevention boundary; ADR 0039 records that residual risk.
