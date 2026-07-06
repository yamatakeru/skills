# ADR 0013: Define Next Runtime Implementation Scope

## Status

Accepted

## Context

Fusion currently has a portable protocol contract and reference runtime skeleton,
but it cannot yet run a real panel through a concrete harness. The next
implementation should make Fusion practically executable without expanding the
scope so far that adapter, recording, synthesis, schema, and compliance design
become coupled.

The immediate needs are:

- real OpenCode and Claude Code headless worker adapters;
- an optional recording boundary for audit and debugging;
- a test suite that fixes selector, manifest, worker request, and compliance
  behavior;
- JSON Schema generation for external consumers;
- a synthesis path that allows panels to complete before model-backed synthesis
  is implemented.

## Decision

The next implementation target is a usable Fusion run backed by both OpenCode and
Claude Code worker adapters.

Claude Code was previously deferred to keep the first complete path narrow and
avoid turning the milestone into an adapter compatibility project before the
recording, schema, synthesis, and compliance seams were stable. That trade-off is
no longer the target for this milestone: Fusion should not be treated as usable
until both OpenCode and Claude Code worker execution paths are implemented enough
to exercise the same portable contract.

The implementation scope is:

- add a Bun-based test suite;
- define a `RunRecorder` boundary;
- use a no-op recorder by default so Fusion can run without writing artifacts;
- provide an opt-in file recorder for audit and debugging;
- when file recording is enabled, write runs under
  `<workspaceRoot>/.fusion-runs/<panelRunId>/` by default;
- when file recording is enabled, write split run artifacts: `request.json`,
  `manifest.json`, `events.jsonl`, `worker-requests.json`,
  `worker-results.json`, `synthesis.json`, `compliance.json`, and
  `result.json`;
- when file recording is enabled, write run records incrementally so partial
  evidence survives worker or process failure;
- redact secrets by default when writing run artifacts;
- require safety checks for project-local recording, including git-ignore or an
  explicit override;
- track recording status such as `not-recorded`, `partial`, `complete`, and
  `failed`;
- implement an OpenCode headless adapter using SDK/API control first;
- implement a Claude Code headless adapter using SDK/API or stream-JSON CLI
  control first;
- add a shared adapter registry or composite worker runner so selected harnesses
  are backed by registered runnable adapters;
- derive runtime `availableHarnesses` from registered adapters where possible;
- mark adapter runs degraded when required policy enforcement or
  evidence cannot be proven;
- continue degraded adapter runs when worker execution succeeds but full
  compliance evidence is incomplete;
- keep direct provider API adapters out of this implementation scope;
- generate JSON Schema from the TypeScript contracts rather than hand-writing a
  parallel schema;
- place generated runtime schemas under `skills/fusion/schema/` so they are
  installed with the Fusion skill;
- expose the first runnable integration through the library API before adding a
  CLI or skill command wrapper;
- provide a deterministic fallback synthesizer so `runPanel` can complete
  without requiring a model-backed synthesis step.

The deterministic synthesizer is a temporary foundation component, not the final
quality target. It should produce predictable, attributable synthesis from
worker outputs and should clearly identify itself in `synthesis.json` with a
strategy such as `deterministic`.

The longer-term direction is a harness-backed synthesizer, with OpenCode or
Claude Code as likely implementations. That synthesizer should be added after
worker adapter evidence, the recording boundary, and synthesis artifacts are
stable.

## Consequences

Fusion becomes practically runnable through the two first full-capable reference
targets before supporting every candidate harness.

The skill should not be presented as generally usable until OpenCode and Claude
Code worker adapters can both run through the same library API contract. Before
that point, it remains an implementation preview.

Recording becomes an optional reference runtime capability rather than required
runtime state. Adapter implementations still return events and evidence through
the library contract, while file recording can be enabled when auditability or
debugging requires it.

Project-local `.fusion-runs/` remains the standard file-recorder location because
Fusion run artifacts are project-scoped generated evidence. It is not safe to
write there silently: file recording must be explicit and protected by redaction,
git-ignore checks, restrictive permissions where possible, and visible recording
status.

The deterministic synthesizer keeps tests and early runtime behavior stable, but
it should not be mistaken for the final answer-quality strategy.

Direct provider API adapters remain future work. They should only be introduced
when they can satisfy the same policy and evidence requirements or explicitly run
as degraded text-only adapters.

JSON Schema remains derived from TypeScript to avoid maintaining two divergent
contract definitions. Runtime schemas live with the skill package because skill
installation does not necessarily include repository-level schema directories.

The first runnable integration is library-first. CLI and skill-command wrappers
should be added only after the OpenCode runner, Claude Code runner, recording
boundary, and schema artifacts are stable.
