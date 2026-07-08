# ADR 0035: Model Entry Kinds Are a Disclosure-Only Open Vocabulary

## Status

Accepted

Decided 2026-07-09 from the model-discovery deliberation round: three
recorded Fusion panels (unified-discovery proposal review, namespace-gap
analysis, CLI grammar deliberation) plus a grilled maintainer session. The
round's implementation surface is ADR 0036.

## Context

The round started from a usability proposal: parent agents must know each
harness's own enumeration command (`opencode models`, `cursor-agent
models`) and entry syntax conventions, so a unified "callable models"
query on the bundled CLI looked attractive.

Investigation established that the word "model" in `--models` spans
semantically different namespaces, and that the difference is per entry,
not per harness:

- Claude Code accepts capability-tier aliases (`fable`, `opus`, `sonnet`,
  `haiku`) that the service resolves to the current version of a tier,
  and concrete `claude-*` version ids, in the same entry slot
  (`isClaudeModelId`). It has no enumeration command by design: the tier
  hierarchy is the namespace, so "list the callable models" has no
  catalog-shaped answer.
- OpenCode entries are provider-qualified catalog ids from an open,
  enumerable aggregator catalog; the list itself is the contract.
- Cursor entries are routing products (`auto` is a routing policy, not a
  model), explicit-prefix-only because the namespace overlaps every other
  provider's (ADR 0030), with requested-id vs observed-display-name
  divergence recorded as evidence.
- Fusion's own alias table (`openai-flagship`, `budget-smart`) is a
  hand-built tier layer over the catalog namespace — compensation for the
  staleness of concrete catalog ids, replicating what Claude Code's
  namespace provides natively.

A recorded panel unanimously concluded that a flat unified enumeration
cannot be honest across these namespaces, and a second recorded panel
stress-tested the taxonomy against future harnesses: the current three
harnesses sample provider-, aggregator-, and harness-owned indirection
but not user-owned names (Azure-style deployments, fine-tuned model ids),
local artifact references (digest-pinned local models), or runtime slots
(a "currently loaded model"). The claim that three harnesses cover the
namespace space is survivorship bias over the currently integrated set.
The durable structure underneath the kinds is dimensional: resolution
stability (concrete / moving pointer / routing policy), enumerability,
indirection owner (provider / aggregator / harness / user / fusion), and
validation authority.

## Decision

Resolved model entries carry a namespace-kind label:

- `kind` is assigned **per entry**, derived from the routing path the
  composition already took, never inferred independently of it.
- `kind` is an **open string vocabulary**, mirroring the `HarnessKind`
  extensible pattern. Initial assignment:

  | Routing path | kind |
  | --- | --- |
  | Model alias table names (`openai-flagship`, `budget-smart`) | `fusion-alias` |
  | Claude tier aliases (`fable`, `opus`, `sonnet`, `haiku`) | `tier-alias` |
  | Concrete `claude-*` ids and provider-qualified OpenCode entries | `catalog-id` |
  | All `cursor:` entries | `routing-product` |

  The cursor assignment is deliberately coarse (namespace-level): entry
  strings cannot distinguish `auto` from product model names without a
  registry of Cursor semantics Fusion does not have. Refinement happens
  by adding or splitting kinds when the semantics become verifiable.
- `kind` is **disclosure-only**. Consumers must not dispatch behavior on
  it. Routing authority remains the composition policy (pattern rules and
  forced prefixes in `routeModelEntry`) and the harness adapters; unknown
  model entries remain hard errors (unchanged). Discovery and reporting
  surfaces must render unknown kinds opaquely with a warning rather than
  failing.
- A companion `validatedBy` field (open vocabulary; initial values
  `harness-list`, `pattern`) records the strongest validation actually
  performed on the final resolved id: `harness-list` for entries checked
  against `opencode models` / `cursor-agent models` (including alias-table
  entries whose resolved target was checked), `pattern` for Claude entries
  whose real availability is confirmed only by the worker attempt.
- No additional kinds are minted now. `version-id` (splitting concrete
  ids out of `catalog-id`) has no consumer today. `deployment-id`
  (user-owned indirection) is the known missing cell and the expected
  first addition when a harness with user-named deployments is adopted;
  `artifact-ref` and `runtime-slot` are recorded candidates. Adding a
  kind is a label plus documentation, not a contract break.

## Consequences

- `ResolvedPanelModel` gains `kind` and `validatedBy` (additive; existing
  fields unchanged). The first user-facing surface is the ADR 0036
  dry-run preflight.
- Future harness adoption rounds must assess namespace-kind fit as part
  of the capability probe. A Codex CLI round is expected to be low-risk
  (concrete OpenAI ids plus floating aliases both fit existing kinds); a
  harness exposing user-owned names triggers the `deployment-id`
  addition.
- Guarded-against failure modes, recorded so reviews can enforce them: a
  closed kind enum (guarantees a breaking change per new namespace),
  scattered dispatch on kind (loses the single routing authority and, on
  an open string type, exhaustiveness checking), and consumers inferring
  properties from kind (enumerability, stability, and ownership get their
  own fields if a consumer ever needs them; kind does not imply them).
- The deferred model-listing feature (ADR 0036) inherits this vocabulary:
  a listing renders entries in accepted entry syntax with kinds, and the
  Claude row is honestly non-enumerable rather than forced into catalog
  shape.
