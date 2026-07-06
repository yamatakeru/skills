This file is supplementary guidance for Fusion. The executable runtime protocol
remains in `../SKILL.md`. Do not rely on this file being read at runtime.

# Blind Panel

Blind panel is the canonical Fusion mode. It is closest to OpenRouter Fusion's
panel-and-synthesis idea because each panelist receives the same task and works
without assigned roles.

## Core Properties

- Same prompt for every panelist.
- No assigned roles, personas, or debate positions.
- No participant sees another participant's output before synthesis.
- Diversity comes from model differences, stochastic reasoning paths, and tool
  usage rather than explicit lenses.
- The parent agent synthesizes instead of voting mechanically.

## Prompting

Send each panelist the full user task and essential shared context. Do not
rewrite the task to imply a preferred answer. If the task depends on repository
state, include the relevant files or ask panelists to inspect them independently
when tools are available.

## Panel Size

- 2 panelists: quick sanity check.
- 3 panelists: default for meaningful independent comparison.
- 4 panelists: useful for high-stakes or broad tasks.
- More than 4: use only when the user explicitly accepts higher cost and
  latency.

## Degraded Mode

The bundled CLI is the normal execution path. If it cannot run at all, an
internal same-agent simulation is permitted only as an announced emergency
fallback. Keep passes separated conceptually, synthesize them with the same
five findings, and state that the result is degraded rather than a
full-compliance Fusion panel.

## Model Diversity

For stronger diversity, use the CLI's `--models` option with provider-qualified
OpenCode model IDs, Claude aliases, alias-table names, or explicit harness
prefixes. The selected workers still receive the same prompt; model choice must
not become a role, persona, or specialty lens.

Independent runs may use the same underlying model more than once when each run
remains blind and independent. This treats stochastic reasoning paths and tool
usage as diversity sources, not as separate roles.
