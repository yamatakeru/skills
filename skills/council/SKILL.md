---
name: council
description: >-
  A role-divided structured-review skill for complex coding, architecture,
  design review, debugging, migration planning and other high-stakes tasks.
  Specialized subagents such as scout, architect, critic and verifier inspect
  the task from different angles, then the parent agent synthesizes agreements,
  conflicts, partial coverage, unique insights and blind spots.
license: MIT
compatibility: >-
  SKILL.md-compatible agents; optimized for OpenCode hidden subagents. Falls
  back to internal role passes when hidden subagents are unavailable.
metadata:
  version: "0.1.0"
  kind: "role-divided structured review"
  primary-client: "opencode"
  fallback-mode: "internal"
  optional-subagents: "council-scout,council-architect,council-critic,council-verifier"
---

# Council

Council is a role-divided structured-review protocol for coding, design,
architecture, debugging, migration planning and other tasks where explicit
division of labor improves judgment.

Use `fusion` instead when you want a Fusion-faithful blind panel: same prompt,
no assigned roles, independent answers, then synthesis. Council is not a Fusion
mode; it is an OpenCode-oriented expert-review workflow.

## Runtime Rules

These rules are authoritative even if supplementary files are not read:

* Use Council only for ambiguous, high-stakes, multi-aspect, or explicitly
  requested review tasks. Answer trivial or narrow tasks directly.
* Give every role subagent the full user task and essential shared context. Do
  not pre-digest the task into a preferred answer.
* Spawn only roles that are useful for the task; do not use all roles by
  default.
* Keep role subagents independent: do not show one participant another
  participant's output before synthesis.
* Subagents are read-only by default. `council-verifier` may run safe, allowed,
  targeted checks but must not edit files.
* Do not request, expose, synthesize or record private chain-of-thought from
  role subagents. Roles should provide concise reasoning summaries, evidence,
  sources, tool results, assumptions, uncertainties and verification notes
  instead.
* Do not recursively spawn additional councils or panels from any participant.
* The final answer must be grounded in the synthesis, not copied from one role
  verbatim.

## Invocation Options

Users may specify lightweight CLI-style options in natural language. Treat
these as preferences, not as a strict parser contract:

```text
council --roles scout,critic,verifier で、この変更方針をレビューして。
council --verify で、この設計案のリスクと検証方針を見て。
```

Supported options:

* `--roles <list>`, `-r <list>`: comma-separated roles to use, such as `scout`,
  `architect`, `critic`, and `verifier`.
* `--record`: save provenance under `.council-runs/` when the environment and
  permissions permit it.
* `--verify`: include `council-verifier` when safe and useful.

If the user asks for same-prompt independent paneling, recommend or invoke
`fusion` instead.

## When To Use

Use Council when the task benefits from explicit division of labor:

1. Architecture or migration planning.
2. Risky implementation plans.
3. Complex bug triage.
4. Code review with correctness, security, or maintainability concerns.
5. Tasks where verification evidence materially changes the answer.

Do not use Council for small factual questions, simple edits, obvious bug
fixes, or tasks where latency and token cost are not justified.

## Roles

Spawn only the requested or useful roles:

* `council-scout`: repository or research context, facts, files, conventions
  and missing context.
* `council-architect`: design choices, tradeoffs, migration paths and minimal
  implementation strategy.
* `council-critic`: correctness, security, edge cases, maintainability and test
  gaps.
* `council-verifier`: targeted tests, lint, typecheck, build or repro commands
  when safe and allowed.

Useful role sets:

* `--roles scout,critic`: quick context plus risk review.
* `--roles architect,critic`: competing design and critique.
* `--roles scout,architect,critic`: strong design review without command
  execution.
* `--roles scout,architect,critic,verifier`: full review when verification is
  useful and allowed.

## Execution Tiers

Choose the lightest tier that preserves quality:

### Tier 0 - Direct Answer

If the question is narrow and well scoped, answer directly. Do not
over-deliberate trivial prompts.

### Tier 1 - Internal Role Review

If hidden subagents are unavailable or disabled, perform lightweight internal
passes for the useful roles and synthesize them. Do not recursively spawn more
councils.

### Tier 2 - Hidden Role Agents

When subagents are available, spawn the useful `council-*` agents. Give each the
full task and shared context. The role prompt may focus the lens, but it must
not hide important context or steer toward a preferred answer.
Council diversity comes from assigned roles, not from requiring distinct models.
Multiple roles may use the same underlying model when each role remains
independent until synthesis.

## Synthesis

Structure the synthesis with these five findings:

1. **Agreements**: facts or recommendations supported across roles.
2. **Conflicts**: role priorities, evidence, or recommendations that conflict.
3. **Partial coverage**: important aspects only some roles addressed.
4. **Unique insights**: valuable role-specific observations.
5. **Blind spots**: relevant questions or perspectives nobody addressed.

Attribute important points to their source. Council outputs are not same-prompt
votes; treat them as role-specific evidence and judgment. For code or artifact
tasks, prefer executed verification over persuasive prose and state what was or
was not verified.

## Provenance And Record Keeping

If `--record` is requested and safe, save prompt and options, role identifiers
when known, each role's returned structured output excluding private
chain-of-thought, synthesis, final answer, verification evidence, tool-result
references, assumptions, uncertainties and degraded-mode notes under
`.council-runs/`. Do not persist secrets, unnecessary private data or full
reasoning traces. If recording is unavailable, mention that when relevant.

## Cost And Latency

Invoking a council increases token usage and latency. Use the smallest useful
role set, avoid broad verification unless justified, and answer directly when
structured review is not worth the cost.

## Supplementary Details

The runtime protocol above is complete and authoritative. The following files
are optional guidance for deeper operation and must not be required for
correctness:

* `details/role-review.md`
* `details/synthesis.md`
* `details/provenance.md`
