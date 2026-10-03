# ADR 0048: Tolerate OpenCode-Appended Deny Rules

## Status

Accepted. Partially supersedes ADR 0046's exact ordered suffix verification and
its OpenCode 2.0.12 target/boundary. ADR 0046's other transport, isolation,
cleanup and evidence decisions remain unchanged. Tracking:
[issue #24](https://github.com/yamatakeru/skills/issues/24).

## Decision

OpenCode v2.0.21 introduced upstream
[`82bb5ff88`](https://github.com/anomalyco/opencode/commit/82bb5ff88)
("hide browser tools unless a desktop is attached", #52309). Its BrowserPlugin
runs after config and appends `{"action":"browser","resource":"*","effect":"deny"}`
to every agent. Fusion's exact suffix check therefore stopped every OpenCode
worker and judge before session creation with
`OPENCODE_EFFECTIVE_RULES_MISMATCH`, although Fusion's ordered rules were
present unchanged.

Fusion now requires its expected ordered rules, beginning with the catch-all
deny, as one exact contiguous run that is followed only by rules whose effect is
`deny`. Any appended `allow` or `ask` still fails closed before session
creation. Accepted appended denies stay in the recorded effective rules and are
listed in a compliance note. The Enforcement Source remains
`verified-effective`; no contract type or schema changes.

This relies on OpenCode v2.0.22's `evaluate`, which takes the last matching rule
(`rulesets.flat().findLast(...)`), so a later deny can only narrow the policy.
An appended `ask` is unsafe, not merely noisy: Fusion's deny would become ask,
pass the initial deny check, and saved project rules may then upgrade it to
allow. If OpenCode changes this last-match evaluation, verification must be
revisited; the suffix check cannot detect such a change by itself.

An appended deny that shadows one of Fusion's allows is accepted. The check
guards against widened permissions, not degraded capability; such denials are
visible in tool and denial evidence at runtime.

The owner confirmed that Fusion needs no backward compatibility. The supported
boundary is stable OpenCode 2.0.x from **2.0.22**, the measured target, and the
type-only `@opencode/client` pin follows it.

## Considered Options

- **Keep the exact suffix**: rejects every OpenCode release since 2.0.21.
- **Allow only the known `browser:*` deny**: equally safe, but each further
  plugin deny would stop Fusion again. The upstream permission and browser
  plugin code changed several times per week in September 2026.
- **Allow any appended deny** (chosen): absorbs reversal of the upstream change
  and further deny-only additions while still failing closed on widening.

## Consequences

The same commit lets a desktop browser attachment append a `browser` allow to
**session** permissions, which are merged after agent rules. Fusion verifies
agent rules only, so a session-level allow added after verification is outside
this check. This is accepted as residual risk: it requires an attachment to the
password-protected, run-owned server, which Fusion never initiates. Verifying
session permissions is deferred until there is a concrete need.

OpenCode v2 is releasing patches roughly daily. Run the no-model contract check
in the runbook after each OpenCode upgrade.
