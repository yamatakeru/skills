---
name: fusion-council
description: >-
  A lightweight, Fusion‑inspired council skill for complex research,
  architecture, design, code review and other high‑stakes or ambiguous tasks.
  It supports two deliberation styles – a **role‑based council** and a
  **blind independent panel** – both of which yield a structured synthesis
  highlighting consensus, contradictions, partial coverage, unique insights
  and blind spots.  Optimised for OpenCode, but portable to any agent
  harness supporting SKILL.md loading.  When hidden subagents are
  available, it will use them; otherwise it falls back to an internal
  council.
license: MIT
compatibility: >-
  SKILL.md‑compatible agents; optimised for OpenCode.  Uses hidden
  subagents when available; falls back to internal council otherwise.
metadata:
  version: "0.3.0"
  kind: "multi‑agent deliberation"
  modes: "council,panel"
  primary‑client: "opencode"
  fallback‑mode: "internal"
  optional‑subagents: "fusion-scout,fusion-architect,fusion-critic,fusion-verifier,fusion-panelist"
---

# Fusion Council: blind panel and role‑based council

Fusion Council is a general‑purpose deliberation protocol inspired by
OpenRouter's Fusion system but adapted for agentic coding and research
workflows.  It is not an OpenRouter Fusion API wrapper and does not call
the OpenRouter Fusion API directly.  Instead, it implements a
skill-level panel-and-synthesis protocol that can be used by agents.  It
allows you to turn a single query into multiple independent perspectives
and then synthesise them into one coherent answer.  It offers two
complementary modes:

* **Blind Independent Panel** – multiple subagents receive the same
  prompt verbatim and are not assigned specific lenses.  They answer
  independently without seeing each other's work.  This mode mirrors
  OpenRouter's Fusion: diversity comes from stochastic differences in
  reasoning paths and tool usage rather than from assigned personas.
  This is the default mode when Fusion Council is invoked without an
  explicit mode.

* **Role‑based Council** – an OpenCode-oriented extension where
  different subagents tackle the task from different roles (e.g. scout,
  architect, critic, verifier), each with their own permissions.  This
  is ideal when you know which lenses you want to apply (design, risk,
  implementation, verification) and want structured diversity.  It is
  Fusion-inspired, but less faithful to OpenRouter Fusion than the blind
  panel because the roles intentionally bias each subagent's view.

In both modes, the parent agent synthesises the responses into a
structured analysis, surfacing **consensus**, **contradictions**,
**partial coverage**, **unique insights** and **blind spots**.  It then
writes a final answer grounded in that analysis rather than picking
one answer verbatim.  The goal is to capture not only what everyone
agrees on but also where opinions diverge and what nobody addressed.

The council is reserved for **hard or high‑stakes tasks**.  Direct
answers are still appropriate for simple factual queries or
straightforward code edits.  Reaching for a council on every
prompt wastes time and tokens.

## Invocation options

Users may specify lightweight options in natural language or key-value
style.  Treat these as preferences, not as a strict CLI syntax:

```text
fusion-council --mode blind --panelists 3 --record で、この設計をレビューして。
fusion-council -m council --roles scout,critic,verifier で使って。
```

Supported options:

* `--mode <blind|council|auto>`, `-m <blind|council|auto>`: deliberation
  mode.  If omitted, use `blind` unless the user's wording clearly asks
  for role-based review, verification, or implementation planning.
* `--panelists <n>`, `-p <n>`: number of blind independent panelists to
  spawn when available.  Prefer 2-4; avoid more unless the user
  explicitly accepts higher cost and latency.
* `--roles <list>`, `-r <list>`: comma-separated role-based council
  members to use, such as `scout`, `architect`, `critic`, and
  `verifier`.
* `--record`: save provenance under `.fusion-runs/` when the environment
  and permissions permit it.
* `--verify`: include verification planning or verification commands
  where safe and allowed.

## When to use

Use Fusion Council only when one or more of the following hold:

1. The question is open‑ended, ambiguous or requires judgement.
2. Incorrect answers would be costly (legal, medical, financial,
   production code, architecture decisions).
3. The problem has multiple plausible approaches or trade‑offs.
4. The user explicitly asks for a "fusion", "panel", "ensemble", or
   multi‑model answer.

For routine coding tasks (e.g. a small bugfix), a strong single model
is adequate and faster.  The council can be called explicitly via
`/fusion-council` if available, or implicitly when the user asks for
deliberation.

## Modes and tiers

Fusion Council chooses between three tiers based on the task and the
availability of hidden subagents.  Do not hard‑code a tier; instead
let the parent agent decide as follows:

### Tier 0 — Direct answer (no council)

If the question is narrow and well scoped (e.g. "What is the capital
of France?", "Rename this variable"), answer directly without
invoking any council.  Don't over‑deliberate trivial prompts.

### Tier 1 — Internal council (fallback)

If hidden subagents are unavailable or disabled, the parent model
performs its own internal council: it makes two or more internal
passes over the task (e.g. via self‑reflection or self‑consistency)
without any external tool calls.  It then synthesises the passes into
a structured analysis with consensus, contradictions, partial
coverage, unique insights and blind spots.  This provides some
diversity without requiring subagents.  Keep internal councils
lightweight; do not recursively spawn more councils.

### Tier 2 — Blind independent panel (default when subagents exist)

If hidden subagents are present and the user invokes Fusion Council
without selecting a mode, use a blind independent panel by default.
Spawn two or more neutral panelist subagents, preferably
`fusion-panelist` or model-specific copies of it, with the **same
prompt** and no assigned roles or personas.  Do not seed them with
different system messages; the diversity should come from stochastic
sampling, model differences, and tool use rather than from artificially
different lenses.  Make sure each subagent cannot see the others' work.
After they return, synthesise as above into consensus, contradictions,
partial coverage, unique insights and blind spots.  Use the blind panel
for deep research questions, multi‑model cross‑checking, or when the
user requests a "panel", "ensemble", "fusion", or does not specify a
mode.

### Tier 2 (alternative) — Role‑based council

If hidden subagents are present and the problem benefits from
multiple lenses, spawn a role‑based council with up to four
specialised subagents:

* **fusion-scout** – explores the codebase or research context,
  retrieves relevant files and facts, and notes background that the
  other agents might need.  Read‑only; no edits.
* **fusion-architect** – proposes design choices, high‑level
  approaches and trade‑offs.  Read‑only; no edits.
* **fusion-critic** – acts as sceptic and risk assessor; points out
  potential flaws, security issues and edge cases.  Read‑only; no
  edits.
* **fusion-verifier** – runs tests, lint, type checking or other
  verification tools.  Use `bash` only when necessary and ask
  permission if the project warrants it.  This subagent should not
  perform edits.

This mode is an OpenCode-oriented extension, not the most literal
OpenRouter Fusion mode.  Use it when the user explicitly asks for
role-based review, or when the task is a coding/design problem where
division into research, design, critique and verification is more useful
than same-prompt independent convergence.

Each subagent receives the full task description and any context the
parent can provide.  Do **not** summarise or pre‑digest the task.
Subagents should work independently: they must not see each other's
messages or answers until synthesis.  After all subagents have
responded, the parent synthesises their responses into the five
sections (consensus, contradictions, partial coverage, unique
insights, blind spots), attributes each piece to its source and
produces a final answer grounded in this analysis.  This tier is
suitable for architecture decisions, complex bug triage, policy
reviews, and other tasks where distinct roles are helpful.

## Synthesis

Regardless of mode, the synthesis step is the same:

1. **Consensus** – facts or recommendations that all panelists
   independently converge on.  Treat these as your highest confidence
   elements; lead your final answer with them.
2. **Contradictions** – places where panelists make mutually
   exclusive claims.  List them explicitly and do not smooth them
   away; conflicting answers signal uncertainty or competing
   perspectives.
3. **Partial coverage** – important aspects of the task that only
   some panelists addressed.  Note these and consider whether you
   need to fill in gaps (e.g. via follow‑up questions or tools).
4. **Unique insights** – valuable points raised by a single panelist.
   Highlight these for further investigation; they can be hidden gems.
5. **Blind spots** – obvious questions or perspectives that none of
   the panelists addressed.  Call these out explicitly as future
   work or as items needing external validation.

After writing the analysis, compose the final answer.  For research
or design tasks (Track B), summarise the consensus, incorporate
unique insights, flag contradictions and blind spots, and make a
recommendation if appropriate.  For code or artifact tasks (Track A)
(e.g. generating code, scripts, configuration), run each proposed
solution if possible, compare their behaviours, and integrate the
working parts into a single complete artifact.  Explain what you
verified and how you merged competing implementations.  Always
ground your final answer in the analysis.

## Provenance and record keeping (optional)

When tools and environment permit, record the full panel or council session.
For example, save each panelist's output, the structured analysis and
the final answer to files under a `.fusion-runs/` directory.  Include
metadata such as the model slug or configuration used for each
panelist and any degraded panel notes.  This provenance is essential
for auditing and debugging high‑stakes decisions.

## Cost and latency

Invoking a council or panel increases both token usage and latency.
Each subagent produces a full answer, and synthesis requires careful
reading and structuring.  Only use the council when the cost is
justified.  If the user simply needs a quick factual answer or a
minor code edit, skip the council and answer directly.

## Usage summary

1. **Assess the task and options** – decide whether to answer directly
   (Tier 0), run an internal council (Tier 1), or spawn subagents
   (Tier 2).  Respect explicit options such as `--mode blind`,
   `-m council`, `--panelists 3`, `--roles scout,critic`, `--record`,
   and `--verify`.  If Fusion Council is invoked and no mode is
   specified, use blind panel by default unless the user's wording
   clearly calls for role-based review or verification.
2. **Spawn subagents** – spawn multiple `fusion-panelist` subagents for
   blind panel, or allocate up to four hidden subagents (scout,
   architect, critic, verifier) for role‑based council.  For actual model diversity, create model-specific copies such as `fusion-panelist-claude.md`, `fusion-panelist-openai.md`, and `fusion-panelist-gemini.md`, each with a different `model:` line in its frontmatter.  Provide the
   full user task verbatim; do not summarise or pre‑digest it.  Ensure
   subagents cannot see each other's output.
3. **Collect responses** – wait for all subagents to return.  For
   role-based code tasks, include `fusion-verifier` when verification is
   requested or clearly useful, and use its test, type check or lint
   results as execution evidence.
4. **Structure the analysis** – synthesise panelist responses into
   consensus, contradictions, partial coverage, unique insights and
   blind spots.  Attribute each point to its source and include test
   results where relevant.
5. **Compose the final answer** – for research/design tasks, lead
   with consensus and incorporate unique insights; flag
   contradictions and blind spots; make recommendations if
   appropriate.  For code tasks, run each candidate, merge the
   working parts and document what you verified and how you resolved
   conflicts.
6. **Record provenance (optional)** – if possible, save the panel
   prompt, each answer, the analysis and the final output for
   auditing.  Note any model degradations (e.g. missing CLI, timeouts).
7. **Communicate clearly** – inform the user that a panel or council was
   invoked, summarise what models or subagents participated, and
   include any caveats or unresolved uncertainties.

By following these guidelines, Fusion Council lets you harness
multiple perspectives for better judgement while keeping costs and
complexity under control.
