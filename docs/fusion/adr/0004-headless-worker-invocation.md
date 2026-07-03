# ADR 0004: Make Worker Invocation Non-Interactive By Default

## Status

Accepted

## Context

Fusion workers are intended to run as independent panelists. Interactive approval
prompts inside workers reduce efficiency, make multi-worker runs difficult to
automate, and can create inconsistent behavior across panelists.

Existing OpenCode subagent examples may request approval for some operations,
but frequent approval prompts degrade the Fusion experience.

## Decision

Fusion worker invocation is headless and non-interactive by default.

In default headless mode, a worker run must not require a TTY or user approval
prompt. Operations that would require approval should be denied or returned as a
structured error unless they were allowed by the worker's `toolsPolicy` before
execution.

Rare interactive prompts may be allowed only by explicit adapter or user policy.
This is not the default behavior.

## Consequences

Worker permissions should be decided before invocation through `toolsPolicy`.

The orchestrator or parent agent, not the worker, should handle approval-heavy
operations when possible.

Harness adapters must report whether a run was fully non-interactive or used an
explicit prompt-allowing policy.

## Guidance

- Default worker mode: strict non-interactive.
- Safe read-only tools may be pre-approved.
- Risky tools should be denied by default.
- If prompts are allowed, that policy must be explicit and recorded.
