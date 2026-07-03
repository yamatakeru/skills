# ADR 0012: Adopt Headless SDK Harness Policy

## Status

Accepted

## Context

Fusion is primarily a harness-neutral protocol and library. Concrete harnesses are
adapter implementations, not the domain model. The first practical worker
runtime should avoid the extra complexity of interactive modes, OpenCode
subagent files, or thin direct-provider API wrappers.

The current target harnesses are OpenCode, Cursor CLI, Claude Code, and pi. These
harnesses are useful because they can provide coding-agent behavior, model
selection, tool execution, and machine-readable output through SDK, API, or
headless CLI surfaces. SDK or API control is preferred when available because it
usually gives better session, permission, event, and metadata evidence than CLI
stdout alone.

Operational constraints also matter. Claude-family models may need Claude Code
when subscription or routing constraints make Claude Code the practical access
path. Cursor CLI may be useful when Cursor Ultra provides the available model
budget. pi is useful as a general harness fallback similar in shape to OpenCode.

## Decision

The initial reference worker runtime targets headless invocation only.

The preferred implementation path is SDK or API based headless invocation. CLI
headless invocation is acceptable only when the adapter can still provide the
required policy enforcement and compliance evidence.

The reference harness set is:

- `opencode`
- `cursor-cli`
- `claude-code`
- `pi`

The default reference selector prefers `opencode` and prefers `claude-code` for
Claude-family model preferences when available. This is an overrideable reference
policy, not a portable protocol requirement.

If an adapter policy provides an explicit empty `availableHarnesses` list, worker
selection must fail rather than silently selecting a default harness.

A harness is full-capable only when its adapter can do all of the following:

- create or prove a fresh worker session;
- observe and report the actual model used;
- record the rendered prompt and shared context identity through the
  `ContextManifest`;
- apply the requested read-only tool policy as an effective harness policy;
- deny edit and write operations;
- deny recursive delegation, including subagents, panels, or delegated subtasks;
- resolve headless approval requests as deny or structured error by default;
- capture worker output and tool events;
- record session or run id, usage, errors, and relevant harness metadata.

Harnesses that cannot meet all of these conditions may still run workers, but the
orchestrator must downgrade compliance or report the missing evidence.

Direct provider API adapters are not an initial reference harness. They may be
added later only if they meet the same full-capable harness criteria rather than
acting as thin multi-model HTTP wrappers.

## Consequences

OpenCode and Claude Code are the first full-capable harness targets.

Cursor CLI and pi are useful harness candidates, but they should be treated as
conditional or degraded until their adapters prove equivalent permission control,
delegation denial, ask handling, and event evidence.

OpenCode `fusion-panelist*.md` files remain optional reference examples or
fixtures. They are not the primary runtime path for the portable library.

Harness adapters must surface enough evidence for the orchestrator to derive
compliance. Worker self-reporting is not sufficient.

The current `InvocationMode` type mixes interaction mode, launch mechanism, and
transport. Future contract revisions should split those axes if SDK-based
headless adapters become concrete implementation targets.
