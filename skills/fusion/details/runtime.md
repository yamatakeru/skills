This file is supplementary reference for Fusion. Everything the parent agent
must do to run a panel and author the answer is in `../SKILL.md`; this file
explains how the CLI resolves and enforces those choices. The CLI enforces all
of it, so the parent does not need to re-check these rules by hand.

# Runtime Reference

## Contents

- Model entries and routing
- Default panel composition
- Judge selection
- CLI options
- Dry-run, output, and exit codes
- Harness environment

## Model entries and routing

- `provider/model` routes to OpenCode.
- Claude aliases `fable`, `opus`, `sonnet`, `haiku`, and `claude-*` IDs route
  to Claude Code. Aliases resolve to the latest model of that tier; pass a full
  `claude-*` ID to pin a version.
- `strong-generalist`, `efficient-generalist`, `openai-flagship`, and
  `budget-smart` resolve through the bundled alias table. The latter two are
  compatibility aliases and are not used by the default composition.
- `opencode:<entry>` and `claude-code:<entry>` force those harnesses.
- `cursor:<model-id>` selects Cursor. Cursor is explicit-prefix only: it is
  never selected by aliases, bare model patterns, or default composition.
- Unknown entries are errors, not guesses.

Availability checks:

- OpenCode-backed entries are checked against `opencode models`. On v2 this
  may start a shared background catalog service, including during dry-run;
  Fusion executes workers on a separate owned server and does not stop that
  shared service.
- Claude Code has no model enumeration command; Claude-backed entries use
  latest aliases and `--fallback-model`, then are validated by the worker
  attempt.
- Cursor-backed entries are checked against `cursor-agent models`.

`bun <skill-dir>/bin/fusion-run.ts --help` prints the complete runtime alias
table and ordered candidate chains.

## Default panel composition

The default panel has three workers. Same-harness panels are allowed. Slots
are filled in this priority order:

1. `parent` slot from `--parent-model`.
2. `strong` slot through the `strong-generalist` alias.
3. `efficient` slot through the `efficient-generalist` alias.

If `--parent-model` is missing, the CLI warns and refills that slot from the
bundled alias fallback lists. Duplicate default model IDs are deduped, then
refilled from unused strong candidates followed by unused efficient
candidates. If those distinct candidates are exhausted for an effective panel
size of three or fewer, remaining seats repeat only the resolved parent model
under the `parent-repeat` slot and emit degraded warnings. Without a resolved
parent, or at four or more panelists, insufficiency remains an error.
Explicit `--models` duplicates remain allowed.

Automatic default candidates are privacy-eligible only; free models
are available solely through explicit `--models` entries.

`--models <comma-list>` replaces the default composition entirely, including
the parent slot.

## Judge selection

By default a separate no-tools judge runs through the same headless adapter
path after the workers. Its preference defaults to the resolved
`--parent-model` entry, even when `--models` replaces the panel. Without
`--parent-model` or `--judge-model`, the judge uses the selected harness's
default model with a warning. `--judge-model <entry>` overrides the
preference and uses the same routing rules as worker entries. The preference
does not guarantee that worker and judge invocation-time fallbacks land on the
same observed model.

The judge harness does not have to match any worker harness: an explicit
judge strategy is added to the panel's worker harness list for judge selection
only, and the runtime still rejects a harness without a registered runner.

Cursor can judge with `--judge-model cursor:<model-id>` or
`--synthesizer cursor` on the SDK transport. `--synthesizer parent-agent` and
`--synthesizer deterministic` are explicit-only escapes that skip the judge.

If the judge fails, times out, or returns invalid core JSON, the report warns,
omits structured `analysis`, and shows the deterministic audit synthesis plus
raw worker outputs instead.

## CLI options

`--help` lists every option with its default. Semantics it does not state:

- `--panelists`: 2 is a quick sanity check, 3 the default, 4 suits
  high-stakes or broad tasks; go beyond 4 only when the user accepts the cost
  and latency.
- `--read-root` applies to every worker in the run; `containment.md` covers
  its limits.
- `--record` writes only when `.fusion-runs/` is git-ignored; with
  `--dry-run` it warns and records nothing.
- `--json` prints `PanelResult` for panel runs, or `DryRunReport` with
  `mode: "dry-run"` for dry runs.
- `--transport cli` is an explicit opt-in for Claude Code only, with degraded
  compliance evidence. OpenCode and Cursor entries (workers or judge) under
  `cli` are usage errors; there is no silent transport fallback.
- `--worker-timeout-ms` and `--judge-timeout-ms` apply to every harness;
  `--judge-timeout-ms` is valid only with the harness-backed judge. There is
  no unbounded mode.
- `--worker-prompt-variant` is for experiments; leave it unset.
- Reasoning and budget options a harness cannot honor are reported as
  warnings, never silently dropped.

## Dry-run, output, and exit codes

Dry-run resolves composition, judge preference, transport guards, and the
context manifest, then exits before constructing the runtime or recorder. It
invokes no workers and no judge, but it does shell out to `opencode models` and
`cursor-agent models` when availability checks need them. It does not start the
owned OpenCode server, so it does not exercise the server version gate,
provider credentials, or runtime permission verification.

Default Markdown output starts with run status, compliance tier, and warnings,
then lists each worker's full output with worker id, model, harness, and
status, then the judge analysis (or the deterministic audit synthesis when the
judge did not run or failed).

Panel exit code is 0 for `ok` and `partial`, and 1 for `failed` or usage
errors. Dry-run exits 0 only when the full composition resolves cleanly,
otherwise 1 with the diagnostic the real invocation would raise.

## Harness environment

Every worker gets one rendered prompt: the full task, the portable worker
instructions, the output contract, and the shared context, with no roles,
personas or peer output. Workers return concise reasoning summaries,
evidence, sources, assumptions, uncertainties, and verification notes;
private chain-of-thought is never requested or recorded.

Worker tools default to read-only local access, a read-only shell allowlist
(git inspection plus read-only search and listing commands), and web search
and fetch where the harness provides them. Writes, other shell commands,
delegation, and recursive panels are denied. `containment.md` explains what
this does and does not prevent, and how the report discloses it.

Each OpenCode worker and the judge get a fresh session on a run-scoped
server. Web search uses the Exa provider in the run-scoped config without
changing user settings; a provider failure stays visible as a tool failure,
and Fusion never switches providers on its own.

Cursor workers run from a run-scoped scratch directory whose hooks enforce the
shell allowlist, delegation denial, and declared read roots, with web tools
enabled.
