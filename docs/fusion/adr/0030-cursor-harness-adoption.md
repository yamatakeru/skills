# ADR 0030: Adopt Cursor as the Third Reference Harness

## Status

Accepted

Decided 2026-07-07 after a grilled design session. Amends ADR 0012's
reference harness set naming (`cursor-cli` becomes `cursor`). Extends
ADR 0015 (default composition explicitly unchanged) and ADR 0023 (judge
eligibility). The probe-informed transport and enforcement decisions are
recorded in ADR 0032; the portable-contract change this round pressured is
recorded in ADR 0031. Phase 1 (capability probe) completed the same day;
phase 2 (adapter implementation) is pending.

## Context

The reference harness set has named Cursor since ADR 0012, as `cursor-cli`,
with the stance that it "may be useful when Cursor Ultra provides the
available model budget" and should stay "conditional or degraded until their
adapters prove equivalent policy enforcement and evidence." No adapter,
routing, or evidence existed; the name was a contract reservation only.

Four goals now motivate adoption, in priority order confirmed with the user:
subscription flat-rate model capacity (the account was upgraded to Pro for
verification, with Ultra planned), access to Cursor-exclusive models
(`composer-2.5` family), specific model quality available through Cursor,
and validating the portable contract against a third harness.

`cursor-agent` 2026.07.01-41b2de7 is installed, authenticated, and was live
probed (ADR 0032). Its model list includes the composer family alongside
frontier OpenAI and Anthropic models under subscription quota.

The reserved kind name `cursor-cli` predates ADR 0028, which made transport
(`sdk` | `cli`) an axis orthogonal to `HarnessKind`. A kind that embeds a
transport in its name would force self-contradictory descriptors such as
`cursor-cli` + `transport: "sdk"`. No adapter has shipped, so the rename is
free today and expensive after user-visible surfaces (forced prefixes,
`--synthesizer` values) exist.

## Decision

- **Kind name**: the harness kind is `cursor`, matching the product-name
  granularity of `opencode` and `claude-code`. `cursor-cli` is removed from
  the spec, glossary, domain model, and `HarnessKind` union. The CLI binary
  name `cursor-agent` is an adapter implementation detail.
- **Routing**: cursor-backed model entries are selected only through the
  explicit forced prefix `cursor:<model>` (for example
  `cursor:composer-2.5`). No bare-name routing: Cursor's model namespace
  overlaps every other provider's, and bare-name inference would violate the
  "unknown entries are errors, not guesses" rule. Alias-table entries and
  bare `composer*` routing are deferred until composer-family exclusivity is
  confirmed in practice.
- **Default composition**: unchanged (ADR 0015 slots stay parent /
  `openai-flagship` / `budget-smart`). Cursor is explicit-selection only.
  Revisiting the default composition or alias fallback lists is a separate
  follow-up once operational reliability is observed.
- **Judge eligibility**: `cursor` becomes a valid judge harness in the same
  round (`--synthesizer cursor`, `--judge-model cursor:<model>`), because the
  judge rides the worker adapter path (ADR 0023) and excluding it would
  punch a hole in the documented model-entry routing contract. The judge
  default (parent model) is unchanged.
- **Compliance stance**: full tier is the target, not a shipping gate. If
  enforcement evidence falls short, the adapter ships degraded with the
  missing evidence disclosed in compliance notes and the gaps recorded —
  the same treatment the OpenCode CLI path received under ADR 0022. The
  known gaps and their disclosures are recorded in ADR 0032.
- **Milestone placement**: an independent round, executed next, not a
  prerequisite of and not blocked by milestone 5 (the ADR 0026 judge-tools
  re-decision). Cursor may join milestone 5 comparison arms only as an
  option if its evidence lands cleanly first.

### Acceptance criteria for the round

1. Probe findings recorded (handoff + ADRs) and the deferred transport and
   enforcement decisions resolved (done; ADR 0032).
2. A recorded `--models` panel including at least one cursor worker
   completes with every worker `ok` and a correct report.
3. A recorded `--judge-model cursor:<model>` run completes with judge `ok`
   (or a disclosed degraded outcome).
4. `bun test`, `bun run typecheck:fusion`, and `bun run schema:fusion`
   green, with intended schema diffs from the `HarnessKind` and ADR 0031
   contract changes.
5. If enforcement supports it, an ADR 0029-analog two-arm verification on
   cursor (denied external access disclosed by a surviving worker; declared
   access succeeding). Where cursor semantics make an arm meaningless (see
   ADR 0032 on open reads), the divergence disclosure replaces the arm.
6. Spec, glossary, domain model, `types.ts`, `SKILL.md` (version bump), and
   the handoff updated.

## Consequences

- The manual smoke matrix grows to three harnesses until milestone 2 (CI)
  lands; `cursor-agent login` (or `CURSOR_API_KEY`) becomes a documented
  smoke prerequisite.
- `pi` remains a name-only candidate under ADR 0012's conditional stance;
  nothing in this round changes its status.
- The subscription-capacity goal depends on the account's paid plan; the
  Free tier exhausts mid-panel (observed live during the probe, ADR 0032)
  and is not a supported operating point.
