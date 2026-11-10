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
- Library contract

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
  shared service. An initially empty successful catalog is retried within a
  bounded window.
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

Automatic default candidates are privacy-eligible only (ADR 0041); free models
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

Known limitation: the judge can only run on a harness that at least one worker
uses. With explicit `--models` on one harness and a judge entry routed to
another (for example OpenCode-only workers with `--judge-model sonnet`),
dry-run passes but the real run fails judge selection with `harness preference
is not available`, produces neither judge analysis nor deterministic audit
synthesis, and reports `partial`. Until this is fixed, keep the judge on a
harness that one of the `--models` workers uses.

Cursor can judge with `--judge-model cursor:<model-id>` or
`--synthesizer cursor` on the SDK transport. `--synthesizer parent-agent` and
`--synthesizer deterministic` are explicit-only escapes that skip the judge.

If the judge fails, times out, or returns invalid core JSON, the report warns,
omits structured `analysis`, and shows the deterministic audit synthesis plus
raw worker outputs instead.

## CLI options

- `--parent-model <entry>`: model entry for the default parent slot and judge;
  normally the calling agent's own model, but explicit overrides are allowed.
  Does not change the calling agent's model.
- `--models <comma-list>`: explicit model list; replaces default composition.
- `--panelists <n>`: panel size for default composition; default 3, maximum 20.
- `--context <text>`: shared context brief given to every worker.
- `--context-file <path>`: embed a file into the shared context; repeatable.
- `--read-root <dir>`: declare a directory outside the workspace as readable
  (recursive) for every worker in the run; repeatable.
- `--effort <low|medium|high|xhigh>`: worker reasoning effort; default is the
  provider default.
- `--reasoning-max-tokens <n>`: worker reasoning token budget.
- `--max-turns <n>`: per-worker turn budget where the harness supports it.
- `--dry-run`: preflight this exact invocation without running workers or judge.
- `--record`: write split artifacts under `.fusion-runs/<panelRunId>/` when the
  directory is git-ignored. With `--dry-run`, it warns and records nothing.
- `--json`: print `PanelResult` for panel runs, or `DryRunReport` with
  `mode: "dry-run"` for dry runs, instead of Markdown.
- `--transport <sdk|cli>`: default `sdk`. `cli` is an explicit opt-in for
  Claude Code only, with degraded compliance evidence. OpenCode and Cursor
  entries (workers or judge) under `cli` are usage errors; there is no silent
  transport fallback.
- `--judge-model <entry>`: override the judge model.
- `--synthesizer <parent-agent|deterministic|opencode|cursor|claude-code>`:
  harness-backed judge is the default.
- `--worker-timeout-ms <n>`: wall-clock limit for each worker invocation;
  default 600000. Applies to every harness.
- `--judge-timeout-ms <n>`: wall-clock limit for the judge, independent of the
  worker limit; default 300000. Only valid with the harness-backed judge.
  There is no unbounded mode.
- `--worker-prompt-variant <suppression-only|upstream-minimal>`: experiment
  scoped; normal runs leave it unset.

Reasoning and budget options a harness cannot honor are reported as warnings,
never silently dropped.

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

The CLI renders one prompt for all workers: the same full task, the portable
worker instructions, the output contract, and the shared context. It assigns
no roles, personas, debate positions, or specialty lenses, and shows no worker
peer outputs, draft synthesis, or panel conclusions before that worker returns.
Workers are asked for concise reasoning summaries, evidence, sources,
assumptions, uncertainties, and verification notes; private chain-of-thought
is never requested, exposed, synthesized, or recorded.

Worker tools default to read-only local access, a read-only bash allowlist (git
inspection plus read-only search and listing commands), and web search and
fetch where the harness provides them. Writes, non-allowlisted shell commands,
subagents, delegation, and recursive panels are denied. A denied request is a
structured tool error: the worker keeps running and discloses the denial.

The Instruction Environment is a standing harness input (ADR 0043/0045):

- Claude Code blocks user, project, and local memory via an empty
  `--setting-sources` list and auto memory via
  `--settings '{"autoMemoryEnabled":false}'`.
- OpenCode SDK blocks user/global instruction layers by redirecting both
  `OPENCODE_CONFIG_DIR` and `XDG_CONFIG_HOME` and unsetting `OPENCODE_CONFIG`;
  project and ancestor `AGENTS.md` still inject.
- Cursor account-level User Rules remain injected regardless of
  `CURSOR_CONFIG_DIR`.

Worker and judge prompts carry injection-subordination clauses (ADR 0044), and
reports disclose these facts in compliance notes and the Instruction
environment header line.

OpenCode uses an authenticated, run-scoped v2 server, native ordered permission
rules, and a fresh session for each worker and judge. It verifies the actual
server version and effective rules before invoking models, waits for terminal
execution events, and interrupts sessions before disconnecting. Unsupported
release lines fail explicitly; see `containment.md` for the supported boundary.
Web search uses the owner-approved Exa provider in the run-scoped config,
without changing user settings or switching providers automatically; a
provider failure stays visible as a tool failure.

Cursor workers use a run-scoped scratch cwd with project hooks to enforce the
read-only bash allowlist, recursive delegation denial, and declared read-root
semantics while keeping web tools enabled. Undocumented `CURSOR_CONFIG_DIR`
and headless hook loading remain smoke-monitored surfaces.

The shell allowlist is enforced but is not a sandbox; `containment.md` covers
the threat model, residual holes, evidence layers, and crash recovery.

## Library contract

In the library contract, `PanelSpec.workers` is the per-slot preference list:
each slot may carry `{ model, harness }`. `lib/protocol.ts` is the public entry
point.
