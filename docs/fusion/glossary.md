# Fusion Glossary

## Fusion

A portable blind-panel protocol inspired by OpenRouter Fusion. Multiple neutral
workers receive the same task and shared context independently. A parent
orchestrator then synthesizes consensus, contradictions, partial coverage,
unique insights, and blind spots.

## Portable Spec

The harness-neutral definition of Fusion behavior. It defines protocol
requirements independently of OpenCode, Claude Code, pi, or any other concrete
execution environment.

## Harness

An execution environment capable of invoking workers. Examples may include
OpenCode, Cursor CLI, Claude Code, or pi.

## Harness Adapter

A component that maps the portable Fusion contract onto a concrete harness.
Adapters are implementation details and are not themselves the portable spec.

## Adapter Registry

The runtime wiring that maps selected harness kinds to concrete worker runners.
The registry prevents a selector from choosing a harness that the current runtime
cannot execute.

## Worker

An independent model or agent invocation participating in a Fusion panel. A
worker receives the same prompt and shared context as peer workers and returns a
self-contained result.

## Panel

A set of independent workers invoked for the same Fusion task.

## Orchestrator

The parent process or agent that selects workers, invokes harness adapters,
collects worker results, checks compliance metadata, and performs synthesis.

## Blindness

The property that no worker can see peer worker outputs, draft synthesis, or
other panel-internal conclusions before it returns its own result.

## Isolation

The property that a worker runs in a separate or otherwise proven clean context
so that prior panel state, peer outputs, or synthesis drafts cannot influence the
worker.

## Full Compliance

A Fusion run that uses true independent workers, same prompt, same shared
context, blindness, and isolated contexts before synthesis.

Full compliance is determined by the orchestrator from evidence, not asserted by
workers themselves.

## Context Manifest

A digest-bearing record of the rendered worker prompt, shared context, files,
and references given to workers. It lets the orchestrator verify that workers
received the same task inputs.

## Rendered Prompt

The exact prompt sent to a worker, including the user task, portable worker
instructions, and output contract. This is the prompt identity boundary for full
compliance.

## Provenance Event Log

The panel-level audit trail used to derive and explain compliance. It records
important lifecycle events such as context manifestation, harness selection,
worker invocation, synthesis, and compliance evaluation.

The event log is a compliance audit log, not a complete execution trace. Full
compliance requires the minimum events needed to verify same input, independent
worker invocation, terminal worker status, synthesis provenance, and
orchestrator-derived compliance.

## Partial Synthesis

A synthesis produced from fewer than the requested workers because one or more
workers timed out, failed, refused, or returned invalid output. It must disclose
the missing workers and avoid overstating consensus.

## Final Answer

The user-facing response produced after synthesis. It is grounded in the
synthesis but is a separate artifact from the comparative synthesis itself.

## Attribution

Traceability from an important synthesis claim back to one or more worker
outputs, or an explicit note that the claim is orchestrator judgment.

## Recursive Delegation

A worker spawning another panel, council, subagent, or delegated subtask. Fusion
workers deny recursive delegation by default to preserve panel independence and
avoid hidden nested panels.

## Degraded Simulation

A local approximation of Fusion, such as same-agent internal multiple passes,
that does not meet full compliance requirements. It must be disclosed.

## Reference Example

A concrete implementation example for a specific harness. The OpenCode
`agents/fusion-panelist*.md` files are reference examples, not normative protocol
requirements.

## Headless Invocation

A non-interactive worker invocation suitable for automation. A headless worker
run should not require a TTY or user confirmation prompt.

## Full-Capable Harness

A harness whose adapter can provide enough control and evidence for full Fusion
compliance. It must be able to create or prove a fresh worker session, report the
actual model used, apply the requested read-only tool policy, deny edit/write and
recursive delegation, resolve headless approval requests as deny or structured
error by default, capture output and tool events, and record run metadata.

## Reference Harness Selection Policy

The non-normative default harness policy used by the reference implementation or
local deployment. The reference selector prefers OpenCode by default and prefers
Claude Code for Claude-family model preferences when available. Users and
deployments may override this policy.

## Usable Reference Runtime

The first runtime milestone where Fusion can execute through the library API with
both OpenCode and Claude Code worker adapters. Before both adapters exist, the
skill is an implementation preview rather than a generally usable tool. The
milestone is accepted through the smoke matrix in the spec: default panel from a
Claude Code parent, a claude-code-including panel from an OpenCode parent, green
test/typecheck/schema runs, and a verified `--record` artifact set.

## Implementation Preview

A partial runtime that validates contracts or one harness path but is not yet the
usable Fusion skill. In the current plan, OpenCode-only execution is a preview
until Claude Code execution also satisfies the same worker contract.

## SDK Transport

A harness invocation path that uses a harness SDK or API rather than plain CLI
stdout. SDK transport is preferred for headless adapters when it provides better
session, permission, event, usage, and metadata evidence.

## Capability-Based Harness Selection

A harness selection strategy that chooses an adapter based on requested model,
available harnesses, required capabilities, workspace constraints, and user
policy. The portable Fusion protocol does not hardcode model-to-harness routing.

## Run Recorder

The optional reference runtime boundary for recording Fusion run artifacts. The
default recorder is no-op. An opt-in file recorder can write request, manifest,
event log, worker request, worker result, synthesis, compliance, and final result
artifacts under `<workspaceRoot>/.fusion-runs/<panelRunId>/`.

## File Run Recorder

The opt-in recorder that writes project-local Fusion artifacts. It should redact
secrets by default, verify `.fusion-runs/` is git-ignored or require an explicit
override, use restrictive permissions where possible, and report recording status.

## Deterministic Synthesizer

A local fallback synthesizer that produces predictable synthesis from worker
outputs without invoking another model. It exists to make early runs executable
and tests stable; it is not the final quality target. Its output stays in panel
reports and recorded artifacts as an audit reference even when the parent agent
authors the synthesis.

## Parent-Agent Synthesis

The usable-milestone synthesis strategy: the parent agent reads the panel
report and authors the five-finding synthesis and the final answer itself,
without an additional model invocation. It corresponds to OpenRouter Fusion's
outer-model authorship, but merges the judge role into the parent agent.

## Harness-Backed Synthesizer

The planned successor synthesis strategy (also called the harness-backed
judge): a separate worker invocation through a concrete harness, such as
OpenCode or Claude Code, that produces the structured comparison from completed
worker outputs. Selected through `SynthesizerPreference`. It is not subject to
worker blindness because synthesis occurs after worker results are returned,
but it still needs provenance and delegation controls.

## Synthesizer Preference

The contract field naming who authors the synthesis: `parent-agent`,
`deterministic`, or a harness kind for the harness-backed judge.

## Fusion CLI

The bundled Bun entrypoint under `skills/fusion/bin/` that is the single
canonical skill execution path. `SKILL.md` instructs the parent agent to run it
through the harness shell tool; it requires Bun and no npm runtime
dependencies.

## Panel Report

The default stdout contract of the Fusion CLI: a Markdown document carrying run
status, compliance tier, warnings, each worker's full output, and the reference
deterministic synthesis. `--json` replaces it with the complete `PanelResult`.

## Default Panel Slots

The three-slot default composition used when no explicit model selection is
given: the parent model slot (the parent agent's own model, passed via
`--parent-model`), the flagship slot (current OpenAI flagship through
OpenCode), and the budget slot (a cheap-but-capable model through OpenCode).
Slots resolve through the model alias table, deduplicate by resolved model ID,
and refill from unused fallback entries.

## Model Alias Table

The bundled table mapping stable alias names such as `openai-flagship` and
`budget-smart` to ordered, provider-qualified model ID fallback lists. It
absorbs model generation changes through skill updates instead of prompt or
documentation rewrites.

## Emergency Internal Fallback

The only surviving internal-pass path after the legacy tiers were retired: a
same-agent degraded simulation permitted solely when the Fusion CLI cannot run,
required to announce its degraded status before producing results, and
scheduled for removal consideration once the skill matures.

## Secret Redaction

The default file-recording behavior that avoids writing raw secrets, credential
values, or sensitive environment data into run artifacts.

## Runtime Schema

A JSON Schema generated from the Fusion TypeScript contracts and used by the
installed skill at runtime. Runtime schemas live under `skills/fusion/schema/` so
they are installed with the Fusion skill.

## Tools Policy

The worker permission contract for tools such as file reads, search, shell
commands, network access, and edits. Fusion workers default to read-only local
access plus web search and web fetch where the harness provides them; edit,
write, and recursive delegation are denied by default. Workers in the same
panel should receive the same tools policy unless an explicit adapter
limitation or user policy says otherwise.

## Session Reuse

Reusing or resuming a previous harness session for a worker. Session reuse can
improve ergonomics and cost but may weaken blindness or isolation unless tightly
controlled and recorded.

## Fresh Session

A worker session created with no prior panel state. This is the default session
mode for Fusion workers.

## Forked Session

A worker session created from a sanitized bootstrap session. The bootstrap must
not contain worker outputs, synthesis drafts, or panel conclusions.

## Resumed Session

A worker session continued from prior state. A resumed session is compatible with
full compliance only when it has a proven clean same-worker lineage and has not
seen peer outputs or synthesis.
