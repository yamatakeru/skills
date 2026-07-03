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

## SDK Transport

A harness invocation path that uses a harness SDK or API rather than plain CLI
stdout. SDK transport is preferred for headless adapters when it provides better
session, permission, event, usage, and metadata evidence.

## Capability-Based Harness Selection

A harness selection strategy that chooses an adapter based on requested model,
available harnesses, required capabilities, workspace constraints, and user
policy. The portable Fusion protocol does not hardcode model-to-harness routing.

## Tools Policy

The worker permission contract for tools such as file reads, search, shell
commands, network access, and edits. Fusion workers use read-only tools by
default, and workers in the same panel should receive the same tools policy
unless an explicit adapter limitation or user policy says otherwise.

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
