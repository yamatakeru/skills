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
OpenCode, pi, Claude Code, or a direct model API adapter.

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
