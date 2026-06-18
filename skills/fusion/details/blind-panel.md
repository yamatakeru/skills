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

If hidden subagents are unavailable, run internal independent passes instead.
Keep them separated conceptually and synthesize the passes with the same five
findings.

## Model Diversity

For stronger diversity in OpenCode, copy `agents/fusion-panelist.md` to
model-specific agents such as:

- `fusion-panelist-openai.md`
- `fusion-panelist-claude.md`
- `fusion-panelist-gemini.md`

Give each copy a different `model:` line if those models are available in the
environment.
