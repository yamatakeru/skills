# ADR 0029: Permission Pre-Decision and Declared Read Roots

## Status

Accepted

## Amendment (2026-07-07)

The Claude Code arm ("readRoots map to --add-dir") had been asserted from
flag reading and never live-verified; in practice claude's variadic
`--add-dir <directories...>` consumed the trailing positional prompt, so
declaring readRoots deterministically failed any claude-code worker or judge
invocation with exit 1 ("Input must be provided...") -- first observed in the
field on 2026-07-06 as a judge failure misattributed to an invalid LS
permission rule (a harmless stderr warning). The fix terminates option
parsing with `--` before the positional prompt and was live-verified on
2026-07-07 on claude 2.1.201. The consequence claim that the
permission-abort dropout class was "eliminated by design on the default
transport" held for opencode but was inverted for claude-code until this fix.

Implements reserved milestone 6 (the durable fix for permission-abort worker
dropouts) on the ADR 0028 SDK transport. Realizes ADR 0012's full-capable
criterion "resolve headless approval requests as deny or structured error by
default" and extends the ADR 0006/0022 tools-policy application.

Verified live 2026-07-06 (opencode 1.17.13). Both arms of the verification
clause held: a config-denied external read surfaced to the model as a tool
error, the loop continued, and the worker completed with the denial disclosed
in its answer; the same read succeeded when the directory was declared as a
read root. The recorded milestone 6 repro (the exact worker-2 request that
deterministically dropped on the CLI path) completed on the SDK transport.
Mechanics learned in verification: `external_directory` must be governed
through the permission map only — disabling it in the agent tools map blocks
the read-root allows; the enforcement boundary is the project root OpenCode
resolves itself, which can be wider than the declared workspace root (read
roots govern only paths outside that resolved root); and the injected config
merges with the user's global opencode config, so the effective permission
set can be wider than the declared policy — an evidence caveat, not an
enforcement gap in the deny direction we rely on.

## Context

The milestone 6 root cause: when a headless OpenCode worker's tool call is
permission-rejected (typically an `external_directory` read of an absolute
path mentioned in the shared context), the turn ends without a final text
step and the worker drops. Source reading (2026-07-06) confirmed the
mechanism: the rejection error carries a message designed to be read by the
model, but the session processor breaks the step loop on rejection by
default. The continuation flag `experimental.continue_loop_on_deny` exists
but is marked for removal in the v2 config specs, so it cannot be the
foundation of a durable fix. Claude Code does not share the defect: denials
under `--permission-mode dontAsk` return to the model as tool errors and the
loop continues.

The interim stopgap — never writing external absolute paths into worker
context — avoids the crash but leaves the underlying need unmet: real panel
runs do reference files outside the workspace. Upstream Fusion workers have
no local filesystem access at all; context curation by the parent is the
protocol's native pattern.

## Decision

### Semantics (portable, both harnesses)

The pre-granted set is exactly: the declared read-only tools policy within
the workspace, the declared read roots, and web tools where the harness
provides them. Everything else is denied, and a denial must surface to the
model as a structured tool error the worker can react to — never abort the
worker. Blanket auto-allow of read-class requests outside the granted set
was rejected: it would widen "read-only" into "read-anything", muddy the
policy-enforcement evidence, and weaken isolation.

### Read roots

`WorkerRequest.environment` gains `readRoots?: string[]`: directories the
parent explicitly declares readable (recursive) for this run, surfaced on
the CLI as repeatable `--read-root` flags. Unresolvable needs remain what
they are today — the parent inlines the content into shared context instead.

### OpenCode mechanism: asks are designed not to occur

The primary enforcement is config-level pre-decision, injected at server
spawn: an agent definition whose permission map allows the read-only
toolset, allowlists bash by command pattern
(`bash: {"*": "deny", "git *": "allow", ...}` from
`readOnlyBashCommands`), wildcard-denies edit/write and delegation tools —
which also hides them from the model's tool list — and maps `readRoots`
onto `external_directory` allow globs. With every tool call pre-decided,
the abort-prone ask path is never entered.

As a safety net for unexpected asks, the adapter subscribes to permission
events over SSE and auto-rejects, and sets
`experimental.continue_loop_on_deny: true` while the flag exists. This flag
is a recorded deprecated dependency, not a foundation: when it is removed
upstream, the net degrades to today's disclosed dropout for the unexpected
case only.

Verification: the deterministic milestone 6 repro (the recorded worker-2
prompt referencing an external absolute path) must complete with the denial
disclosed in the worker's answer instead of dropping the worker. If
config-level denial turns out to also break the loop, the safety-net flag
behavior is adopted as primary and this ADR must be amended with the
observed mechanics.

### Claude Code mechanism

The existing flag surface already realizes the semantics: `--permission-mode
dontAsk` with explicit allow/deny tool flags. `readRoots` map to `--add-dir`.
The result message's `permission_denials` are captured as evidence.

## Consequences

- The permission-abort dropout class is eliminated by design on the default
  transport: what used to be a silent worker loss becomes a completed answer
  with a disclosed denial, visible to the judge and the parent.
- The external-path stopgap is superseded: shared context may reference
  external paths if the parent declares matching `--read-root`s, or the
  parent inlines the content. An undeclared external reference degrades
  worker answer quality visibly instead of killing the worker.
- Enforcement evidence sharpens: the effective permission config is recorded
  as the observed tool policy, and denials appear in worker evidence rather
  than vanishing into an aborted turn.
- Workers in the same panel keep receiving the same tools policy, including
  identical read roots (ADR 0006 unchanged).
