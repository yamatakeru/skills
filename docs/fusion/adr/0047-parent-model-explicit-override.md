# ADR 0047: Explicit Parent-Model Entry Override

## Status

Accepted. Partially supersedes ADR 0015's own-model self-reporting instruction
and ADR 0023's unconditional equivalence between the default judge and outer
model. Their usual defaults remain unchanged.

## Decision

By default, the calling parent agent explicitly passes its own supported model
entry as `--parent-model`. It may instead explicitly select a different
supported entry. This uses the existing resolver without requiring a separate
option or a complete explicit panel selection merely to substitute one seat.
The CLI cannot discover the actual calling model and does not change it; the
calling parent still authors the final answer.

The entry selects the default panel's `parent` seat and default judge preference.
`--models` replaces the entire panel, removing that seat but retaining the judge
preference; `--judge-model` takes precedence. Degraded `parent-repeat` seats repeat
the resolved selected parent seat, not an inferred outer model. Preference
resolution does not guarantee identical observed models after invocation-time
fallbacks. If the intended entry is unavailable, omit it rather than assuming
seat refill also makes judge resolution succeed.

No resolver, contract type, or schema changes are required. Reported model
entries remain selection preferences, not independently verified outer identity.
