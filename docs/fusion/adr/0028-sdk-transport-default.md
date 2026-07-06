# ADR 0028: SDK Transport Is the Default Worker Transport

## Status

Accepted

Implements reserved milestone 1 together with ADR 0029. Fulfills ADR 0012's
SDK/API preference and its predicted `InvocationMode` axis split. Preserves
ADR 0014's zero-runtime-dependency property. Resolves the ADR 0022
degraded-compliance divergence on the default transport.

Implemented 2026-07-06 and live-verified against opencode 1.17.13. Endpoint
corrections found only by live runs (the sandboxed implementation pass could
not start the server): the bare-`Event` stream is `/event` (`/global/event`
wraps an envelope the observer does not parse), session creation accepts a
title-only body, and prompt message ids must be `msg`-prefixed. Server
readiness allows 30s and one fresh-port respawn retry (startup flake
observed live). The recorded SDK smoke panel reached compliance tier `full`
with workers and judge both on `transport: "sdk"`; the recorded
`--transport cli` run kept workers and judge uniformly on `"cli"` with the
preserved degraded tier.

## Context

Both worker adapters currently spawn a CLI and parse stdout
(`headless-cli-adapters.ts`). This transport has three structural gaps, all
tracked as milestone 1 acceptance criteria:

- Permission handling: headless OpenCode auto-rejects permission asks, and a
  single rejection ends the turn without a final text step, dropping the
  worker (milestone 6 root cause, diagnosed 2026-07-06 by deterministic
  replay).
- Tool policy: the OpenCode CLI adapter cannot enforce or prove the requested
  read-only policy (ADR 0022 degraded compliance).
- Evidence: `modelUsed` is echoed from the request rather than observed, and
  session ids, token usage, tool events, and permission outcomes are not
  captured even where the harness emits them.

Primary-source research (2026-07-06, opencode monorepo and Claude Agent SDK
docs) established the transport landscape:

- OpenCode exposes a full server API: `opencode serve` (REST + SSE), session
  creation, prompting, per-message model/usage/cost, tool and step events,
  and permission events with a reply endpoint. Config — including agent
  definitions and permission maps — is injectable at spawn time via the
  `OPENCODE_CONFIG_CONTENT` environment variable without disk writes.
- The official `@opencode-ai/sdk` npm client spawns the user-installed
  `opencode` binary itself; pinning the client does not pin the server. The
  package publishes near-continuous snapshots and its monorepo announces a
  successor (`sdk-next`) that will replace it.
- The Claude Agent SDK wraps and spawns a bundled platform-specific CLI
  binary. The evidence this milestone needs from Claude Code — `session_id`,
  resolved model, token usage, `permission_denials` — is already present in
  the `claude --print --output-format stream-json` protocol the current
  adapter receives but only partially parses. Read roots exist as `--add-dir`.
  Denials under `--permission-mode dontAsk` already return to the model as
  tool errors and the loop continues.

A recorded cheap-panel run (gpt-5.5, deepseek-v4-flash-free,
grok-composer-2.5-fast; all three workers completed) unanimously recommended
implementing the SDK transport without npm runtime dependencies, on the
grounds that client pinning does not solve server skew, the required API
surface is ~5 endpoints, and the official OpenCode client is itself unstable
and slated for replacement.

## Decision

### Transport axis

`HarnessDescriptor` gains `transport: "cli" | "sdk"`. `InvocationMode`
narrows to the interaction axis (`"headless" | "subagent"`); the launch and
transport meanings it used to mix move to the new field. Schema regeneration
is expected to produce diffs.

`"sdk"` means the adapter consumes the harness's structured machine protocol:
the OpenCode server API (REST + SSE) for `opencode`, and the stream-json
agent protocol — the same protocol the official Agent SDK wraps — for
`claude-code`. `"cli"` means the legacy plain-stdout adapters. The axis is
defined by the protocol surface and the evidence it yields, not by process
boundaries: the claude-code SDK adapter still spawns the user's `claude`
binary, but consumes the full structured protocol and maps the full policy
surface.

### Default and fallback

SDK is the default transport for workers and the judge (which shares the
worker runner path). The CLI adapters remain registered only under an
explicit `--transport cli` opt-in. There is no automatic fallback: an SDK
transport failure is a disclosed worker/judge failure, not a silent
downgrade to a transport that cannot enforce policy.

### Zero runtime dependencies (ADR 0014 unchanged)

- OpenCode: a hand-rolled client over Bun's built-in `fetch` and SSE line
  parsing, against a self-spawned `opencode serve`: one server per panel run,
  bound to `127.0.0.1` on an ephemeral port, config injected via
  `OPENCODE_CONFIG_CONTENT`, reaped in `try/finally` with SIGTERM→SIGKILL
  escalation. Each worker (and the judge) gets a fresh session via session
  creation; the session id is recorded as isolation evidence.
- Claude Code: the existing headless spawn, upgraded to parse the full
  stream-json protocol (init and result messages) and to map the remaining
  policy flags.
- `@opencode-ai/sdk` is added as a version-pinned devDependency for
  type-only imports (erased at transpile time). A guard test asserts that
  runtime code contains no non-type import of the package, so the installed
  skill still runs without `node_modules`.

### Evidence upgrades

SDK adapters observe rather than echo: `modelUsed` from the harness's
resolved model, session id, token usage and cost, tool events, and
permission outcomes (`permission_denials` on claude-code; permission and
tool-part events over SSE on opencode). The opencode adapter now records the
effective permission config as `observedToolPolicy`, closing ADR 0022's
degraded-compliance divergence on the SDK path; the installed harness binary
version is recorded alongside.

## Consequences

- Milestone 1's three acceptance criteria are met on the default transport;
  landing this triggers the mandatory ADR 0026 judge-tools re-decision,
  which is executed in the milestone 5 comparison round with measured input.
- ADR 0022's divergence persists only on the explicit CLI opt-in path, where
  it remains disclosed.
- The skill keeps its copy-anywhere install story; the cost is a small owned
  protocol client with fixture-backed contract tests and periodic live smoke
  against the installed binaries, which are the real compatibility boundary
  in either design.
- The `sdk-next` migration and OpenCode client churn cannot break the
  runtime; API drift is detected at devDependency bumps via typecheck and at
  smoke runs via the recorded artifacts.
- Panel-identified follow-ups accepted as open work: version/capability
  probing of the installed binaries beyond recording versions, and SSE
  reconnection hardening.
