# ADR 0015: Default Panel Composition Policy

## Status

Accepted

## Context

With the CLI as the canonical path (ADR 0014), an invocation without explicit
options needs a deterministic default panel. Model IDs go stale as providers
ship new generations, the orchestrating parent model differs per session and
per harness, and the CLI process cannot discover the parent model on its own.

## Decision

The default panel size is three workers. Same-harness panels are allowed.

The default composition fills three slots in priority order:

1. **Parent model slot**: the same model the parent agent is running on. This
   is a default, not a requirement; explicit `--models` style selection
   replaces the default composition entirely.
2. **Flagship slot**: the current OpenAI flagship, run through OpenCode.
3. **Budget slot**: a cheap-but-capable model (DeepSeek-class), run through
   OpenCode.

The parent model is conveyed explicitly: `SKILL.md` instructs the parent agent
to pass its own model ID as `--parent-model`. When it is missing, the CLI warns,
fills the slot from the fallback lists, and marks the omission in the report.

Model staleness is handled by a bundled alias table with ordered fallback lists
(for example `openai-flagship` and `budget-smart`) in the runtime defaults,
reusing the existing `ModelPreference.fallbacks` contract. OpenCode-backed slots
verify availability against `opencode models`. Claude Code has no model
enumeration command; Claude-backed slots use the built-in latest aliases
(`fable`, `opus`, `sonnet`, `haiku`) plus `--fallback-model`, validated by
attempt.

After resolution, duplicate model IDs are removed and freed slots are refilled
from the next unused fallback entry, keeping three distinct models. Running the
same model more than once is allowed only by explicit user selection.

Model entries are routed to harnesses by pattern: `provider/model` goes to
OpenCode, Claude aliases and `claude-*` IDs go to Claude Code, alias-table names
resolve through the table. An explicit `opencode:` or `claude-code:` prefix
forces the harness. Unrecognized entries are errors, not guesses. While the
supported harness set is OpenCode and Claude Code, Claude models route
unconditionally to Claude Code; routing Claude models through another harness
(such as Cursor CLI) may be revisited when that harness becomes a practical
option.

## Consequences

A bare `fusion` invocation from Claude Code produces a mixed panel
(claude-code x1 + opencode x2) and exercises both harnesses by default. From an
OpenCode parent whose model is not Claude, the default panel may be
OpenCode-only; both-harness coverage is then exercised through explicit
selection, which the acceptance criteria require.

Model generation changes are absorbed by editing the alias table in a skill
update, not by rewriting documentation or prompts.

The parent-model slot depends on the parent agent self-reporting its model ID;
provenance records the reported value and any substitution.
