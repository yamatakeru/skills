# ADR 0052: SKILL.md Is a Parent-Facing Guide with Progressive Disclosure

## Status

Accepted. Replaces the repository convention, stated in `AGENTS.md` and the
skill README, that `SKILL.md` carries the "complete runtime protocol". No
earlier ADR recorded that convention.

## Context

`SKILL.md` had grown to about 300 lines by stating every runtime rule:
harness instruction-blocking flags, OpenCode server verification, Cursor
hooks, the default-panel refill algorithm, the full option list (also printed
by `--help`), the library contract, and version and migration history. Most
of it is enforced or disclosed by the CLI, so the calling agent could not act
on it, and the per-run report already repeats the disclosures. Version
statements also went stale with the code: on 2026-11-10 the skill still said
"2.0.x or 2.1.x" while the installed OpenCode 2.2.6 was rejected at runtime
(ADR 0051).

Current guidance from both model vendors points the other way:

- Anthropic, "The new rules of context engineering for Claude 5 generation
  models" (2026-07-24): Claude Code's system prompt lost over 80% "with no
  measurable loss on our coding evaluations"; skills should be "lightweight
  guides", avoiding overconstraint "except in highly important areas", and
  long skills should "use progressive disclosure as much as possible".
- Anthropic, "Lessons from building Claude Code: How we use skills"
  (2026-06-03): "The highest-signal content in any skill is the Gotchas
  section"; descriptions describe when to trigger, not a summary.
- OpenAI, "Rethinking skills and prompts for GPT-6 Astra": descriptions
  "should be as short as possible while making it clear when the model should
  use them"; contradictory or over-emphasised descriptions load unhelpful
  skills; multi-workflow skills should make the root document "a minimal
  router".
- Claude skill authoring best practices: body under 500 lines, references one
  level deep, no time-sensitive information in the body.

The original convention protected against a real failure: an agent that does
not open a referenced file. That failure is still reported for skills, so the
fix keeps everything needed to act in `SKILL.md`.

## Decision

`SKILL.md` holds what the calling agent needs to run a panel correctly and
author the answer: when to use it, how to invoke it, what context to pass,
how to read the report, the protocol invariants it can affect (neutral, same
prompt for every worker; partial is not consensus; no silent alternative
execution path), a Gotchas section grown from observed failures, and the
announced emergency fallback. It must remain sufficient without reading
`details/`.

Runtime internals the CLI enforces or discloses move to `details/runtime.md`
and the existing `details/` files. `SKILL.md` links each file once, with the
situation in which to read it. Version ranges live in the frontmatter
`compatibility` field, ADRs, the runbook, and `details/containment.md`, not in
the body. Migration history stays in ADRs.

The description is written as a trigger: what the skill does in one sentence,
when to use it, explicit trigger phrases, and what it is not for (narrow
lookups and routine single-pass code review, which another review skill
covers).

## Considered Options

- **Keep the complete protocol in `SKILL.md`**: safest against unread
  references, but the body contradicts current vendor guidance, duplicates the
  report and `--help`, and has already gone stale.
- **Minimal router only** (a few lines pointing to `details/`): matches the
  router advice literally, but makes correct use depend on reading other
  files, which is the failure the original convention guarded against.
- **Parent-facing guide plus conditional references** (chosen).

## Consequences

New failure modes found in real runs are added to the Gotchas section.
Behavior changes update `SKILL.md` only when they change what the calling
agent must do; otherwise they update `details/`, the spec, and tests. Worker
and judge prompt wording is out of scope here; changing it needs comparative
evidence (ADR 0020).
