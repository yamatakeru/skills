# ADR 0053: Admit the OpenCode 2.3 Release Line

## Status

Accepted. Partially supersedes ADR 0051's supported boundary ("stable 2.0.x
from 2.0.22, or any stable 2.1.x or 2.2.x") and its 2.2.6 type-only pin. ADR
0050's reasoning for admitting a whole minor line, and every ADR 0046/0048
decision, remain unchanged.

## Context

The installed OpenCode was upgraded to v2.3.0. Fusion's version gate only
matched `^2\.([012])\.(\d+)$`, so a real panel rejected every OpenCode worker
with `Unsupported OpenCode version 2.3.0` before sessions were created. The
default panel places two workers on OpenCode, so it could not run at full
strength. Dry-run did not reveal this because it does not start the owned
server or read its version.

## Evidence (2026-11-15)

- The no-model contract check
  (`skills/fusion/test/opencode-containment.integration.test.ts`), run against
  the real `opencode v2.3.0` binary with only the gate relaxed, passed:
  authentication, `/api/info` identity, native effective rules, parked prompt
  admission, interrupt and owned process shutdown.
- A manual probe of an owned 2.3.0 server with Fusion's config showed the
  expected `fusion-worker` and `fusion-judge` rules as one exact ordered run,
  followed only by appended denies (`browser:* deny`, `skill:browser deny`),
  which ADR 0048 already tolerates. `/api/event` still opens with
  `server.connected`.
- Upstream `packages/core/src/permission.ts` is byte-identical between tags
  `v2.2.6` and `v2.3.0`
  ([`a6b15d33`](https://github.com/anomalyco/opencode/tree/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7)).
  It keeps the last-match evaluation that ADR 0048 depends on:
  `rulesets.flat().findLast((rule) => Wildcard.match(action, rule.action) && Wildcard.match(resource, rule.resource))`.
- The `@opencode/client` 2.2.6 to 2.3.0 type diff is additive for the
  endpoints and events Fusion reads: new `session.step.first-token` and
  `experimental.mcp.event` events, which the event collector ignores, and
  new optional fields (`freeform`, `tls`, `firstToken`, generate usage).
  `bun run typecheck:fusion` passes with `@opencode/client` pinned at 2.3.0.
- The runbook's default-panel live smoke on 2.3.0 (`--parent-model fable`)
  returned run status ok with full compliance and no warnings: both OpenCode
  workers (`openai/gpt-6.1-sol`, `opencode-go/qwen3.8-flash`) succeeded on
  harness version 2.3.0 with `verified-effective` enforcement and successful
  aborts, and the Claude Code worker and judge (`claude-fable-5-2`)
  succeeded.

## Decision

The supported OpenCode boundary is stable **2.0.x from 2.0.22, or any stable
2.1.x, 2.2.x or 2.3.x**. The measured target is **2.3.0**. The type-only
`@opencode/client` pin moves to 2.3.0. Prereleases, 2.4+ and other release
lines still fail explicitly before session creation. A further minor line
needs the same check and a new decision; it is not admitted automatically.

## Considered Options

- **Keep 2.0 to 2.2 only**: stops every OpenCode worker on the installed
  binary; downgrading OpenCode is outside Fusion's scope.
- **Admit 2.3.x alongside the existing lines** (chosen), for the reasons ADR
  0050 gives for admitting whole minor lines.
- **Drop older lines while admitting 2.3**: no evidence that they regressed,
  and dropping them would add a forced upgrade for no safety gain.

## Consequences

After each OpenCode upgrade, run the free contract check in the runbook, and
re-read `Permission.evaluate` and `evaluateInput` when `permission.ts` changes
upstream. Because dry-run does not exercise the server version gate, the
contract check is the cheapest way to notice a newly unsupported release line.

The boundary is defined once, in `isSupportedOpenCodeVersion`
(`skills/fusion/lib/opencode-sdk-adapter.ts`); the contract check reuses it
instead of mirroring the pattern, so admitting a further line changes one
predicate plus its fixtures and documentation.
