# ADR 0055: Skill Docs Carry Only What the Calling Agent Sees or Acts On

## Status

Accepted. Partially supersedes ADR 0052's placement rule that "runtime
internals the CLI enforces or discloses" live in `details/`, and its rule that
version ranges live in "the frontmatter `compatibility` field, ADRs, the
runbook, and `details/containment.md`". ADR 0052's
parent-facing `SKILL.md`, its description, its Gotchas policy and its
one-level progressive disclosure remain unchanged.

## Context

A review of the installed skill (2026-11-23) found that `details/` mixed three
audiences: the calling agent, Fusion maintainers, and readers of the design
history. `containment.md` opened with incident history, cited ADR numbers and
GitHub issues, and described SSE lifecycle, server verification steps and
Cursor permission grammar that the caller never sees. Four `details/` files
still carried the pre-0052 header "Do not rely on this file being read at
runtime", contradicting `SKILL.md`'s instruction to read them.
`provenance.md` still described what a parent agent should record by hand,
not what `--record` writes. Judge-replay commands used repository paths.

The installed skill directory has no `docs/`, so ADR numbers and repository
paths are unreachable for its reader. Most internals in `details/` were
already stated in `spec.md` or an ADR, so the copies only drifted.

The supported OpenCode range was written by hand in seven places: the
version regex, two code comments, the error message, the `compatibility`
field, `containment.md`, and the runbook. Each of the four release-line
admissions (ADR 0050, 0051, 0053, 0054) edited all of them, and ADR 0052
records the skill still saying "2.0.x or 2.1.x" while 2.2.6 was rejected.

Current vendor guidance:

- Claude, "Skill authoring best practices": only add context the model does
  not already have; each paragraph must justify its token cost; reference
  files over 100 lines need a table of contents; avoid time-sensitive
  information.
- Anthropic, "The new rules of context engineering for Claude 5 generation
  models" (2026-07-24): skills are lightweight guides; prefer interfaces that
  explain themselves over duplicated instructions.
- Anthropic, "Lessons from building Claude Code: How we use skills"
  (2026-06-03): don't state the obvious; the whole skill folder is context.
- OpenAI, "Rethinking skills and prompts for GPT-6 Astra": overly specific
  guidance can hinder current models; repository skills are read by other
  models too.
- agentskills.io Playbook: error messages should say what went wrong, what was
  expected, and what to try.

## Decision

- `details/` holds what the calling agent sees or acts on: the meaning of
  report lines, warnings and errors; residual limits; supported boundaries;
  recovery procedures. Internals that are neither shown to the caller nor
  actionable by it live only in `spec.md` and ADRs.
- `SKILL.md` and `details/` carry no ADR numbers, GitHub issue or PR links, or
  repository paths; commands use `<skill-dir>`. A test enforces this and that
  `SKILL.md` links exactly the files in `details/`.
- `details/blind-panel.md` and `details/synthesis.md` are removed: their
  content duplicated `SKILL.md` and `spec.md` in older terminology.
- `details/runtime.md` no longer copies the option list printed by `--help`;
  it keeps only option semantics `--help` does not state.
- `README.md` is for human readers: what the skill does, when to use it,
  installation and update, optional OpenCode configuration, layout, and the
  library entry point.
- The `SKILL.md` frontmatter keeps `name`, `description`, `license` and
  `compatibility`. The unused `metadata` block is removed; installs are
  tracked by commit.
- The unsupported OpenCode version error states what to do next.
- The supported OpenCode range is defined once, as constants in the OpenCode
  adapter from which both the version check and the human-readable range
  (`SUPPORTED_OPENCODE_VERSIONS`) are derived; the error message uses that
  string. The `compatibility` field is the only other copy, and a test asserts
  it contains the string. `containment.md` and the runbook describe the
  behavior and the measured target, not the range. ADRs keep recording each
  admission.

## Considered Options

- **Keep every internal in `details/`, reordered** (ADR 0052 as is): cheapest,
  but keeps a second copy of the spec that has already drifted.
- **Move every internal out, including what the report shows**: shortest
  files, but leaves the caller unable to interpret report lines without the
  repository.
- **Keep what the caller sees or acts on** (chosen).

## Consequences

Behavior changes that alter a report line, warning, error or residual limit
update `details/`; other internal changes update only `spec.md`, ADRs and
tests. The effect on calling agents was not measured; only the paid trigger
check in the runbook or an output eval could measure it.
