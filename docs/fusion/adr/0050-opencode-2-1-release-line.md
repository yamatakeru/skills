# ADR 0050: Admit the OpenCode 2.1 Release Line

## Status

Accepted. Partially supersedes ADR 0048's supported boundary ("stable OpenCode
2.0.x from 2.0.22") and its 2.0.22 type-only pin. ADR 0048's appended-deny
tolerance and every other ADR 0046/0048 decision remain unchanged.

## Context

The installed OpenCode was upgraded to v2.1.4. Fusion's version gate only
matched `^2\.0\.(\d+)$`, so every 2.1.x release was rejected before the
server was used: `Unsupported OpenCode version 2.1.4`. The whole default
panel, which places two workers on OpenCode, could not run. Nothing had
been observed to break; the gate stopped OpenCode because the 2.1 line had
not been checked yet.

## Evidence (2026-10-25)

- The no-model contract check
  (`skills/fusion/test/opencode-containment.integration.test.ts`), run against
  the real `opencode v2.1.4` binary with only the gate relaxed, passed:
  authentication, `/api/info` identity, native effective rules (read,
  websearch and declared read root allowed; shell, webfetch, edit, subagent,
  unknown tool and undeclared external directory denied), parked prompt
  admission, interrupt and owned process shutdown.
- Upstream source at tag `v2.1.4`
  ([`68bc26b7`](https://github.com/anomalyco/opencode/tree/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824)),
  `packages/core/src/permission.ts`, keeps the last-match evaluation that
  ADR 0048 depends on:
  `rulesets.flat().findLast((rule) => Wildcard.match(action, rule.action) && Wildcard.match(resource, rule.resource))`.
  `evaluateInput` still returns `deny` from configured agent and session
  rules before it consults saved rules. The v2.0.22 to v2.1.4 diff of
  `permission.ts` only changes input type declarations and request metadata
  sanitising.
- `bun run typecheck:fusion` passes with `@opencode/client` pinned at 2.1.4.

## Decision

The supported OpenCode boundary is stable **2.0.x from 2.0.22, or any stable
2.1.x**. The measured target is **2.1.4**. The type-only `@opencode/client` pin
moves to 2.1.4. Prereleases, 2.2+ and other release lines still fail
explicitly before session creation. A further minor line needs the same check
and a new decision; it is not admitted automatically.

All 2.1 patches are admitted at once rather than only patches up to 2.1.4. The
runtime check, not the version number, is the safety boundary: Fusion
verifies the actual effective agent rules before every prompt and fails
closed on any appended allow or ask (ADR 0048). Pinning exact patches would
stop Fusion after every release, and OpenCode publishes patches roughly
daily.

## Considered Options

- **Keep 2.0.x only**: stops every OpenCode worker on the installed binary;
  downgrading OpenCode is outside Fusion's scope.
- **Admit up to the measured 2.1.4 only**: safer on paper, but needs a code
  change after each daily patch while adding no check beyond the runtime rule
  verification.
- **Admit 2.0.22+ and all of 2.1.x** (chosen).
- **Remove the release-line gate**: would admit a future major or minor line
  whose evaluation semantics may change without any review.

## Consequences

The last-match dependency cannot be detected by the effective-rule check
alone (ADR 0048). After each OpenCode upgrade, run the free contract check in
the runbook, and re-read `Permission.evaluate` when `permission.ts` changes
upstream. A paid live smoke on 2.1.x has not yet been recorded; until it is,
runtime prompt and SSE behaviour on 2.1 is covered only by the no-model check
and the adapter fixtures.
