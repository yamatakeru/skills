# ADR 0033: Isolation Claims Use Panel-State Semantics Uniformly

## Status

Accepted

Decided 2026-07-08 in a grilled session, before the cursor probe round ran;
confirmed by its results (see ADR 0034 for the probe record).

## Context

The cursor adapter shipped with `adapterClaimsIsolatedContext: false`
hardcoded, citing the unresolved `CURSOR_CONFIG_DIR` merge-versus-replace
question and the possibility of account-level rule injection. That made
"isolated context not proven" a standing degraded reason for every cursor
worker.

The glossary defines Isolation as freedom from *panel-internal* state:

> The property that a worker runs in a separate or otherwise proven clean
> context so that prior panel state, peer outputs, or synthesis drafts
> cannot influence the worker.

User-level configuration and rules are not panel state. And the incumbent
adapters already claim isolation on `session.mode === "fresh"` plus an
observed session id — while claude-code workers receive user-level
CLAUDE.md instructions and opencode workers receive merged global config.
The cursor `false` therefore held one harness to a stricter, undocumented
standard: an environment-cleanliness reading that no other adapter was
measured against.

The alternative — adopting the broad environment-cleanliness reading
everywhere — would flip the incumbents' isolation claims to unprovable
(user-level instruction injection is the norm on every harness) and make
`degraded` the permanent floor for all panels, destroying the tier's
signal value.

## Decision

Isolation claims measure **panel-state isolation**, per the glossary: a
fresh session with an observed session id justifies
`adapterClaimsIsolatedContext: true` on every harness, cursor included.

Environment-cleanliness facts — global-config merge semantics, account
User Rules, workspace file rules — are **compliance evidence notes**, not
inputs to the isolation claim. Where a harness injects user-level context
into workers, the adapter discloses it as a note; the tier is unaffected.

The glossary Isolation entry gains a clarifying sentence recording this
boundary.

## Consequences

- The cursor adapter's isolation claim aligns with the incumbents:
  `session.mode === "fresh" && sessionId !== undefined`. The standing
  "isolated context not proven" degraded reason disappears for healthy
  fresh-session cursor workers.
- The probe round's environment findings (ADR 0034) land as notes:
  injected config fully replaces global permissions (no merge), while
  account User Rules inject into headless runs regardless of
  `CURSOR_CONFIG_DIR` and are disclosed on every cursor worker.
- If a future policy needs environment cleanliness as a gate, it must be
  introduced as its own evidence dimension applied to all harnesses, not
  by re-overloading the isolation claim.
