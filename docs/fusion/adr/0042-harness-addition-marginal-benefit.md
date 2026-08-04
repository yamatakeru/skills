# ADR 0042: Harness Additions Require Exclusive Capability

## Status

Accepted

## Context

The reference harness set is opencode, claude-code, and cursor. pi has been a
name-only candidate since ADR 0012, and the domain model keeps it conditional
or degraded until an adapter proves equivalent enforcement and evidence. A
maintainer proposal evaluated promoting pi to a fourth worker harness, noting
that the maintainer's own pi install is extended with OpenAI server-side
compaction as an example of pi's extensibility. Codex CLI came up in the same
discussion as an analogous candidate.

A recorded flagship dogfooding panel (openai/gpt-5.6-luna via opencode,
claude-opus-5 via claude-code, grok-4.5 via cursor; fable judge; compliance
tier full) deliberated the proposal on 2026-08-05 and unanimously recommended
deferral. Its load-bearing findings, parent-verified against repository
sources but document-based on the pi side (no live probe was run):

- pi's model reach is a subset of the opencode catalog. There are no
  pi-exclusive models, and BYOK access adds metered cost without new quota —
  the opposite of ADR 0030's cursor motivations (flat-rate capacity plus
  exclusive composer models).
- The enforcement-evidence ceiling does not move: opencode already reaches
  `verified-effective`.
- pi has no native permission or approval system. The ADR 0022 bash allowlist
  would require a Fusion-owned pi extension with undocumented fail-closed
  behavior, or dropping bash and its allowlist parity permanently.
- pi ships no built-in web search, web fetch, or MCP — an ADR 0018 parity gap
  that directly hits the deep-research use case.
- pi is pre-1.0 and mid-migration from `@mariozechner/*` / `badlogic/pi-mono`
  to `@earendil-works/*` / `earendil-works/pi`.
- Total adoption cost is cursor-scale (probe rounds, ADRs, adapter plus
  bundled extension, smoke matrix growth from three to four harnesses while
  CI automation, reserved milestone 2, is unlanded).
- Server-side compaction cannot fire in short-lived blind single-task
  workers; if it did fire, it would diverge the recorded transcript from the
  context the model actually saw.

## Decision

A new worker harness is adopted only when it supplies a capability that is
unreachable through the existing set at acceptable cost: exclusive models or
pricing/quota, a strictly stronger enforcement-evidence class, or a required
containment level. Generic catalog overlap does not qualify. Harness-layer
redundancy does not qualify either: the observed failure modes are
provider-side, and opencode already multiplexes providers.

pi is deferred and remains a name-only candidate. Re-evaluation triggers, any
of which reopens the question: a model or price point reachable only through
pi; upstream web/MCP support; a 1.0 release with the namespace migration
completed and a documented backward-compatibility policy; landed CI smoke
automation. Any re-evaluation must additionally prove fail-closed extension
loading live before an enforcement profile may rely on a Fusion-owned
extension.

Codex CLI is not adopted and is not reserved as a harness kind. Its one
distinct capability is native OS-level sandboxing (macOS Seatbelt, Linux
Landlock), which maps to the `sandboxed` containment level that ADR 0039
deferred. When that milestone activates, sandboxing the existing harnesses
from the outside is attempted first; Codex is then evaluated as an
alternative implementation path, a replacement-shaped decision rather than a
fourth-seat addition.

On worker evidence paths, transparency outranks context-management
convenience. Any context transformation that happens outside the recorded
transcript — server-side or automatic compaction, silent retry rewriting,
session persistence — must be disabled, or disclosed as evidence, by any
future adapter. Features that are virtues in long-lived interactive sessions
are liabilities in short-lived evidence-bearing panel workers.

## Consequences

- Future sessions inherit this judgment and its observable triggers instead
  of re-running the deliberation; the panel artifacts live only under the
  git-ignored `.fusion-runs/`, so this ADR is their durable record.
- The spec and domain-model wording for pi (name-only, conditional or
  degraded) remains accurate and unchanged.
- The deferred shared `LazyModelList` extraction stays deferred; no third
  adapter model-list copy appears.
- ADR 0039's sandbox milestone gains a named alternative implementation path
  without widening `HarnessKind`.
- The marginal-benefit test gives future harness proposals (pi, codex, or
  others) a stated bar to argue against rather than an open-ended comparison.
