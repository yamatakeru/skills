# ADR 0014: Bundled CLI Is The Canonical Skill Execution Path

## Status

Accepted

## Context

ADR 0013 made the first runnable integration library-first and deferred CLI and
skill wrappers. The usable milestone now requires that a natural skill
invocation from Claude Code or OpenCode actually starts a real panel, with the
same behavior and the same compliance judgment in both harnesses.

Three execution paths were considered:

- a bundled CLI entrypoint that SKILL.md instructs the parent agent to run;
- parent-agent-authored ad-hoc scripts that call `runPanel` directly;
- harness-native mechanisms (Claude Code agents, OpenCode hidden subagents).

Ad-hoc scripts make the execution path nondeterministic across invocations and
turn script bugs into panel failures. Harness-native mechanisms fork behavior
per harness, cannot start workers on the other harness, and leave compliance
evidence outside orchestrator control.

## Decision

A bundled CLI entrypoint under `skills/fusion/bin/` is the single canonical
skill execution path. `SKILL.md` instructs the parent agent to execute it via
the harness shell tool in both Claude Code and OpenCode.

Bun is the required runtime. The runtime keeps zero npm runtime dependencies so
the skill directory is self-contained: `bun <skill-dir>/bin/fusion-run.ts`
works without `node_modules` wherever the skill is installed. A missing `bun`
must fail with a clear error and installation guidance, not a silent fallback.

The CLI prints a Markdown panel report to stdout by default, designed for the
parent agent to read directly: run status, compliance tier, and warnings first,
then each worker's full output with worker identity, then the reference
deterministic synthesis. A `--json` flag switches stdout to the complete
`PanelResult` JSON for scripting and debugging.

## Consequences

Both harnesses share one execution path, one test surface, and one
orchestrator-controlled evidence chain.

Worker outputs flow into the parent agent's context by design, because the
parent writes the synthesis and final answer (ADR 0016).

The skill depends on Bun being installed. This is accepted; the zero-dependency
constraint keeps the cost of that requirement to a single binary.

Machine consumers must use `--json` rather than parsing the Markdown report.
