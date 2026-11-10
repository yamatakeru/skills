# ADR 0051: Admit the OpenCode 2.2 Release Line

## Status

Accepted. Partially supersedes ADR 0050's supported boundary ("stable 2.0.x
from 2.0.22, or any stable 2.1.x") and its 2.1.4 type-only pin. ADR 0050's
reasoning for admitting a whole minor line, and every ADR 0046/0048 decision,
remain unchanged.

## Context

The installed OpenCode was upgraded to v2.2.6. Fusion's version gate only
matched `^2\.([01])\.(\d+)$`, so a real panel rejected every OpenCode worker
with `Unsupported OpenCode version 2.2.6` before sessions were created. The
default panel places two workers on OpenCode, so it could not run at full
strength. Dry-run did not reveal this because it does not start the owned
server or read its version.

## Evidence (2026-11-10)

- The no-model contract check
  (`skills/fusion/test/opencode-containment.integration.test.ts`), run against
  the real `opencode v2.2.6` binary with only the gate relaxed, passed:
  authentication, `/api/info` identity, native effective rules, parked prompt
  admission, interrupt and owned process shutdown.
- Upstream source at tag `v2.2.6`
  ([`dc2ffcf8`](https://github.com/anomalyco/opencode/tree/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06)),
  `packages/core/src/permission.ts`, keeps the last-match evaluation that
  ADR 0048 depends on:
  `rulesets.flat().findLast((rule) => Wildcard.match(action, rule.action) && Wildcard.match(resource, rule.resource))`.
  `evaluateInput` still returns `deny` from configured agent and session rules
  before it consults saved rules. The v2.1.4 to v2.2.6 diff adds the read-only
  `assertNotDenied` and `allows` service methods and an `Unattended` ruleset
  reference that settles would-be `ask` results for unattended work. The
  upstream comment states "Configured denies still win, as they are evaluated
  first", and Fusion already fails closed on any effective `ask` (ADR 0048),
  so neither change widens worker permissions.
- `bun run typecheck:fusion` passes with `@opencode/client` pinned at 2.2.6.
- The runbook's default-panel live smoke on 2.2.6 (`--parent-model fable`)
  returned run status ok with full compliance and no warnings: both OpenCode
  workers (`openai/gpt-6.1-sol`, `opencode-go/qwen3.8-flash`) succeeded with
  `verified-effective` enforcement, and the Claude Code worker and judge
  (`claude-fable-5-2`) succeeded. An earlier attempt failed only the OpenAI
  worker with `Request failed: 401`; it reproduced with a plain `opencode run`
  outside Fusion and cleared after re-authenticating the provider, so it was a
  local credential problem, not a protocol change.

## Decision

The supported OpenCode boundary is stable **2.0.x from 2.0.22, or any stable
2.1.x or 2.2.x**. The measured target is **2.2.6**. The type-only
`@opencode/client` pin moves to 2.2.6. Prereleases, 2.3+ and other release
lines still fail explicitly before session creation. A further minor line
needs the same check and a new decision; it is not admitted automatically.

## Considered Options

- **Keep 2.0/2.1 only**: stops every OpenCode worker on the installed binary;
  downgrading OpenCode is outside Fusion's scope.
- **Admit 2.2.x alongside 2.0.22+ and 2.1.x** (chosen), for the reasons ADR
  0050 gives for admitting whole minor lines.
- **Drop 2.0/2.1 while admitting 2.2**: no evidence that the older lines
  regressed, and dropping them would add a forced upgrade for no safety gain.

## Consequences

After each OpenCode upgrade, run the free contract check in the runbook, and
re-read `Permission.evaluate` and `evaluateInput` when `permission.ts` changes
upstream. Because dry-run does not exercise the server version gate, the
contract check is the cheapest way to notice a newly unsupported release line.
