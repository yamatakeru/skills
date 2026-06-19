---
name: fusion
description: >-
  A lightweight, Fusion-inspired blind-panel skill for complex research,
  architecture, design review, code review and other high-stakes or ambiguous
  tasks. Multiple neutral panelists receive the same prompt independently, and
  the parent agent synthesizes consensus, contradictions, partial coverage,
  unique insights and blind spots. It is inspired by OpenRouter Fusion's
  panel-and-synthesis workflow, but it is not an OpenRouter Fusion API wrapper.
license: MIT
compatibility: >-
  SKILL.md-compatible agents; optimized for OpenCode. Uses hidden subagents
  when available; falls back to internal independent passes otherwise.
metadata:
  version: "0.4.0"
  kind: "blind-panel synthesis"
  mode: "blind"
  primary-client: "opencode"
  fallback-mode: "internal"
  optional-subagents: "fusion-panelist,fusion-panelist-gpt,fusion-panelist-kimi,fusion-panelist-deepseek,fusion-panelist-glm,fusion-panelist-composer"
---

# Fusion

Fusion is a skill-level blind-panel deliberation protocol inspired by
OpenRouter Fusion's panel-and-synthesis workflow. It is **not** an OpenRouter
Fusion API wrapper and does not call the OpenRouter Fusion API directly.

Fusion's core behavior is same-prompt independent synthesis: give multiple
neutral panelists the full task, keep them independent, then synthesize their
answers into structured findings before writing the final response.

For role-divided review using scout, architect, critic and verifier agents, use
the separate `council` skill instead.

## Runtime Rules

These rules are authoritative even if supplementary files are not read:

* Use Fusion only for ambiguous, high-stakes, open-ended, or explicitly
  requested panel/ensemble/fusion tasks. Answer trivial or narrow tasks
  directly.
* Give every panelist the same full user task and essential shared context. Do
  not pre-digest the task into a preferred answer.
* Do not assign roles, personas, debate positions, or specialty lenses to
  panelists.
* Model-specific panelist agents are allowed and preferred when available, but
  model choice is only a diversity mechanism. It must not change the prompt,
  role, persona, or expected output format for that panelist.
* Keep panelists independent: do not show one panelist another panelist's
  output before synthesis.
* Panelists are read-only by default. They may inspect context or propose
  verification, but they must not edit files.
* Do not recursively spawn additional panels or councils from any panelist.
* Do not request, expose, synthesize or record private chain-of-thought.
  Panelists should provide concise reasoning summaries, evidence, sources, tool
  results, assumptions, uncertainties and verification notes instead.
* The final answer must be grounded in the synthesis, not copied from one
  panelist verbatim.

## Invocation Options

Users may specify lightweight CLI-style options in natural language. Treat
these as preferences, not as a strict parser contract:

```text
fusion --panelists 3 --record で、この設計をレビューして。
fusion --verify で、このバグ修正方針を独立に評価して。
fusion --models gpt,kimi,deepseek で、このAPI設計を評価して。
```

Supported options:

* `--panelists <n>`, `-p <n>`: number of independent panelists to spawn when
  available. Prefer 2-4; avoid more unless the user explicitly accepts higher
  cost and latency.
* `--models <list>`, `-m <list>`: comma-separated model-specific panelist names
  or short aliases to prefer, such as `gpt,kimi,deepseek,glm,composer`. This
  selects panelist implementations, not roles. Give each selected panelist the
  same prompt and output expectations.
* `--record`: save provenance under `.fusion-runs/` when the environment and
  permissions permit it.
* `--verify`: ask panelists to include verification plans or commands where
  safe and relevant. The parent agent decides what to run.

Ignore role options such as `--roles`; if the user asks for role-divided review,
recommend or invoke `council` instead.

Model aliases map to neutral panelist agents when available:

* `gpt` -> `fusion-panelist-gpt`
* `kimi` -> `fusion-panelist-kimi`
* `deepseek` -> `fusion-panelist-deepseek`
* `glm` -> `fusion-panelist-glm`
* `composer` -> `fusion-panelist-composer`

If both `--panelists` and `--models` are provided, use the requested models in
order first, then fill remaining slots with other neutral panelists. If
`--models` names more panelists than `--panelists`, prefer the explicit model
list and treat it as the effective panel size unless cost or latency would be
unreasonable. If a named model-specific panelist is unavailable, mention the
degraded selection when relevant and substitute another neutral panelist or use
Tier 1.

## When To Use

Use Fusion when one or more of the following hold:

1. The question is open-ended, ambiguous, or requires judgment.
2. Incorrect answers would be costly.
3. The problem has multiple plausible approaches or tradeoffs.
4. The user explicitly asks for a fusion, panel, ensemble, or multi-model
   answer.

For routine coding tasks, small bug fixes, or simple factual questions, answer
directly without invoking a panel.

## Execution Tiers

Choose the lightest tier that preserves quality:

### Tier 0 - Direct Answer

If the question is narrow and well scoped, answer directly. Do not
over-deliberate trivial prompts.

### Tier 1 - Internal Blind Panel

If hidden subagents are unavailable or disabled, perform a lightweight internal
blind panel: make two or more independent passes over the same task and
synthesize them into the same five findings. Do not recursively spawn more
panels.

### Tier 2 - Hidden Panelists

When subagents are available, spawn 2-4 neutral panelists. Prefer a diverse set
of model-specific agents such as `fusion-panelist-gpt`,
`fusion-panelist-kimi`, `fusion-panelist-deepseek`, `fusion-panelist-glm` and
`fusion-panelist-composer` when they are configured and available. Use the
generic `fusion-panelist` as a fallback or filler.

Model diversity must preserve the blind-panel contract: every panelist receives
the same prompt and essential shared context, with no assigned role, no persona,
no model-specific instruction, and no visibility into other panelists' outputs.
If a requested model-specific panelist is unavailable, replace it with another
neutral panelist or degrade to Tier 1 rather than changing the task.
Independent runs may use the same underlying model multiple times when each run
remains blind and independent. Diversity from stochastic reasoning paths and
tool use is valid, though distinct models are preferred when available.

## Synthesis

Structure the synthesis with these five findings:

1. **Consensus**: shared facts or recommendations that independent panelists
   converged on.
2. **Contradictions**: mutually exclusive claims; do not smooth them away.
3. **Partial coverage**: important aspects only some panelists covered.
4. **Unique insights**: valuable single-panelist observations.
5. **Blind spots**: relevant questions or perspectives nobody addressed.

Attribute important points to their source. For code or artifact tasks, prefer
executed verification over persuasive prose and state what was or was not
verified. For research or design tasks, lead with consensus, preserve
contradictions and blind spots, and make recommendations only when supported.

## Provenance And Record Keeping

If `--record` is requested and safe, save prompt and options, panelist
identifiers when known, each panelist's returned structured output excluding
private chain-of-thought, synthesis, final answer, verification evidence,
tool-result references, assumptions, uncertainties and degraded-mode notes under
`.fusion-runs/`. Do not persist secrets, unnecessary private data or full
reasoning traces. If recording is unavailable, mention that when relevant.

## Cost And Latency

Invoking a panel increases token usage and latency. Use the smallest useful
panel, avoid broad verification unless justified, and answer directly when
deliberation is not worth the cost.

## Supplementary Details

The runtime protocol above is complete and authoritative. The following files
are optional guidance for deeper operation and must not be required for
correctness:

* `details/blind-panel.md`
* `details/synthesis.md`
* `details/provenance.md`
