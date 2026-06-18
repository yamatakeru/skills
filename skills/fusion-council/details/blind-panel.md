This file is supplementary guidance for Fusion Council. The executable runtime protocol remains in `../SKILL.md`. Do not rely on this file being read at runtime.

# Blind Independent Panel

Blind panel is the default Fusion Council mode because it is closest to OpenRouter Fusion's same-prompt panel-and-synthesis pattern.

## Core Idea

Spawn multiple neutral panelists. Give each panelist the same task and do not assign roles, personas, or debate positions. Diversity should come from independent reasoning, model differences, sampling, and tool use rather than from preselected viewpoints.

## Prompt Handling

- Pass the full user task verbatim.
- Add only essential shared context, such as relevant repository paths or explicit user constraints.
- Do not pre-digest the task into a preferred solution.
- Do not give one panelist another panelist's answer.
- Do not retry a panelist with previous panel outputs unless you explicitly abandon blind mode.

## Panel Size

Use the smallest panel that can add value:

- `2`: quick cross-check or low-cost ambiguity reduction.
- `3`: good default for nontrivial design or research review.
- `4`: high-stakes or strongly ambiguous tasks.
- `5+`: only when the user explicitly accepts cost and latency.

## Panelist Output Shape

Ask panelists for self-contained answers. Useful sections are:

- Answer or recommendation.
- Key evidence or reasoning.
- Caveats and uncertainties.
- What to verify next.

For coding/design tasks, also ask for relevant files inspected, concrete change plan, risks, and verification commands.

## Degraded Blind Panels

If only one panelist is available, be explicit that this is no longer a real blind panel. If all panelists use the same model, still preserve independence and note that model diversity was unavailable. If tool permissions are missing, report that the panel was reasoning-only.

## Model-Specific Panelists

For stronger diversity in OpenCode, copy `agents/fusion-panelist.md` to model-specific agents such as:

- `fusion-panelist-openai.md`
- `fusion-panelist-claude.md`
- `fusion-panelist-gemini.md`

Set a different `model:` line in each file and keep the prompt neutral.
