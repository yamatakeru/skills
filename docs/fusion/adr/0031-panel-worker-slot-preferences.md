# ADR 0031: Panel Worker Slot Preferences Replace Parallel Model Preferences

## Status

Accepted

Decided 2026-07-07 in the cursor-adoption grill (ADR 0030). Amends the
portable contract sketched in ADR 0005 and the spec's `PanelSpec`. Resolves
the standing handoff limitation on `fusionForcedHarnesses`. Implementation
lands with the cursor round's phase 2; schema regeneration diffs are
expected.

## Context

Per-worker harness assignment — which harness each panel slot must run on —
has no field in the portable contract. `PanelSpec.modelPreferences` carries
per-slot models, but the harness routing that `resolvePanelComposition`
derives from model entries travels out-of-band: a `workerId → HarnessKind`
map smuggled through the untyped
`harnessSelectionPolicy.userPolicy.fusionForcedHarnesses` bag
(`panel-composition.ts` → `worker-requests.ts`). The handoff has recorded
this as a known limitation ("revisit if the portable contract grows one")
since the judge round.

Adopting cursor (ADR 0030) makes the pressure structural: cursor entries are
reachable only through the explicit `cursor:` forced prefix, so every cursor
worker rides the untyped bag. The round's goals include validating the
portable contract against a third harness; a load-bearing routing mechanism
hidden in `Record<string, unknown>` is exactly what such validation should
flush out.

Internally, `ResolvedPanelModel` already couples slot, model, and harness as
one unit. The parallel-array shape of the public contract is a historical
artifact, and index-aligned parallel arrays carry an implicit alignment
invariant the contract cannot express.

## Decision

`PanelSpec` gains a first-class per-slot preference object:

```ts
interface PanelSpec {
  workerCount: number;
  workers?: WorkerSlotPreference[];
  parentModel?: ModelPreference;
}

interface WorkerSlotPreference {
  model?: ModelPreference;
  harness?: HarnessPreference;
}
```

- `workers` is index-aligned with worker construction; missing or `undefined`
  entries fall back to defaults, preserving the lookup semantics
  `modelPreferences?.[index]` has today. No new validation invariant is
  introduced.
- `PanelSpec.modelPreferences` is removed, not deprecated: all consumers are
  internal (CLI, composition, worker construction, tests), so no
  compatibility shim is kept.
- The `fusionForcedHarnesses` userPolicy key is removed. Forced harness
  routing is expressed as `WorkerSlotPreference.harness` and honored by the
  harness selector ahead of pattern-based selection, with unregistered kinds
  still rejected by the adapter registry.
- The slot-object shape was chosen over a parallel
  `harnessPreferences?: HarnessPreference[]` array (rejected alternative):
  the pair is the domain's natural unit, already proven by
  `ResolvedPanelModel`, and the object form eliminates the cross-array
  alignment invariant instead of doubling it.

## Consequences

- Spec contract sketch, generated schemas, and `types.ts` change; schema
  regeneration diffs are intended (`panel-request` and dependents).
- `buildWorkerRequests`, `resolvePanelComposition`, the CLI, and tests
  migrate mechanically in phase 2 of the cursor round.
- `harnessSelectionPolicy.userPolicy` returns to being genuinely
  user-defined policy space with no runtime-owned keys.
- Third-party embedders of the library contract (none known) would see a
  breaking change; this is accepted while the spec is draft-status.
