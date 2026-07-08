# Fusion Runtime Handoff

Date: 2026-07-09 (model-discovery round — implemented, PR pending)

This handoff captures the state of the Fusion runtime after the usable
milestone, the worker-investigation round, the harness-backed judge round,
the upstream fidelity round, the SDK transport round (reserved milestones 1
and 6), the cursor harness round (PR #3, merged), the cursor probe
round (PR #4, merged), and the model-discovery round. The design authority
is `docs/fusion/` (spec, domain model, glossary, ADR 0001-0036).

## Model-Discovery Round (2026-07-09): ADR 0035/0036 Implemented

Trigger: a proposal for a harness-abstracted "callable models" listing on
the bundled CLI. Three recorded cheap panels (all opencode-backed workers;
`.fusion-runs/fusion-3d1ae6e1-*` proposal review, `fusion-ca7c1d05-*`
namespace-taxonomy stress test, `fusion-9f696d79-*` CLI grammar) plus a
grilled maintainer session reshaped it twice:

- The word "model" in `--models` spans per-entry namespace kinds
  (claude tiers vs concrete ids vs opencode catalog vs cursor routing
  products vs fusion aliases); a flat unified enumeration cannot be honest
  (claude-code is non-enumerable by design). Entry kinds became a
  **disclosure-only open vocabulary** — never a dispatch key — with the
  ownership dimension (user-owned names, e.g. Azure-style deployments)
  recorded as the expected first future kind (ADR 0035).
- Entry-list validation (`--validate-model`) was rejected for a fidelity
  gap (it cannot catch composition-level failures; recorded concrete case:
  a cursor entry under `--transport cli` passes entry validation, fails
  the real run). The panel unanimously ranked **`--dry-run` on the real
  invocation** first: reuse the actual preparation path, exit before
  recorder/runtime/`runPanel` (ADR 0036). Prompt stays required;
  `--json` is redefined as "structured report of this invocation"
  (`PanelResult` for runs, `DryRunReport` with `mode: "dry-run"` for dry
  runs); exit 0 iff composition resolves cleanly, else the real
  diagnostic; `--record` warns and records nothing. The model listing
  stays deferred with its grammar deliberately unlocked.

Implementation (Codex from ADR 0035/0036; parent-reviewed with one
simplify fix — `kindForRoutedEntry` dropped a redundant forced-harness
parameter): `ResolvedPanelModel` gained `kind`/`validatedBy`,
`DryRunReport` added to types and schema generation
(`dry-run-report.schema.json`), `--dry-run` branch in the CLI, alias-table
resolutions now visible in `usage()` and SKILL.md (v0.10.0), glossary
(Model Entry / Entry Kind / Dry-Run Preflight), spec section, domain-model
ModelEntry value object. `bun test` 122 pass / 0 fail; typecheck clean;
schema regen idempotent apart from the new file.

Live smoke (all passed): default-composition dry-run (real
`opencode models` shell-out; fable tier-alias/pattern, alias slots
fusion-alias/harness-list), explicit `--models` with a cursor entry plus
sonnet judge under `--json` (real `cursor-agent models` check,
discriminated JSON), transport-mismatch case exits 1 with the real
diagnostic, and a recorded 2-worker real panel
(`fusion-e792eb77-*`: gpt-5.5 + deepseek, sonnet judge) — ok, tier
`full`, zero warnings, confirming composition changes did not disturb
real runs.

Review triage (PR #5): CodeRabbit ran twice — the CLI (signed in again by
review time; the earlier signed-out state was transient; 3 findings) and
the GitHub PR integration (4 actionable + 1 nitpick). Dispositions: the
"future date" class (both reviewers) was skipped — commits landed
2026-07-09 JST (= 2026-07-08 UTC), the reviewer evaluates in UTC, and ADR
dates follow the maintainer's local date per the 0033/0034 precedent.
Adopted: `--record`+`--dry-run` warning reworded ("writes no artifacts;
--record has no effect" — the flag does reach the prepared request, so
"ignored" was imprecise), `tier-alias` scoped to the claude-code route in
`kindForRoutedEntry` (previously unreachable-in-practice but now locally
correct without relying on `routeWithForcedHarness` throwing first), and
a 30s `spawnSync` timeout in the CLI test helper. No panel adjudication
needed — all findings were verifiable facts or accepted quick wins.

## Cursor Probe Round (2026-07-08): Probe Complete, Phase 3 In Flight

Goal: resolve the two degraded reasons cursor workers carried ("isolated
context not proven; observed tool policy does not match request") — or
establish they are unresolvable. Grilled decisions before the probe:
isolation claims use panel-state semantics uniformly (ADR 0033; glossary
sharpened), the probe ran under a mandatory restore-to-pristine
constraint, and results land on `feature/cursor-probe-round`.

Probe results (cursor-agent 2026.07.01-41b2de7, Pro; fourteen recorded
runs t1-t14; all live): everything closed in cursor's favor — see ADR
0034 for the full findings and the decided hooks enforcement profile. In
one line each:

- `<cwd>/.cursor/hooks.json` fires in headless `--print` runs (cwd-based;
  `CURSOR_CONFIG_DIR` hooks and `--add-dir` hooks do not load).
- `preToolUse` deny blocks `Task` (recursion denial enforceable;
  `subagentStart` never fires headless); hooks also gate subagent-internal
  tool calls.
- `beforeShellExecution` implements the ADR 0022 read-only allowlist under
  `--force` (web tools XOR shell allowlist is dissolved).
- `beforeReadFile` reproduces ADR 0029 deny-unless-declared read roots.
- `failClosed: true` blocks when the hook fails to start (probed with a
  nonexistent hook command; a hook that starts and then crashes mid-run
  was not probed).
- `CURSOR_CONFIG_DIR` permissions **replace** the global config (marker
  deny control test); injected runs never touch the global config, but
  non-injected runs write model state back to it — always inject.
- `AGENTS.md` / `.cursor/rules/*.mdc` inject from cwd; account-level User
  Rules inject regardless of injection (created/verified/deleted a marker
  rule) — permanent compliance note, not an isolation breaker (ADR 0033).

Cleanup proof: `~/.cursor/cli-config.json` and `~/.cursor/hooks.json`
byte-identical to pre-probe snapshots (diff-verified); the marker User
Rule deleted and its absence re-verified live (t14). Probe artifacts
(transcripts, hook event logs, restore script, snapshots) under
`~/.claude/jobs/09634e98/tmp/probe/`.

Phase 3 (implemented by Codex/GPT-5.5 from ADR 0033/0034; reviewed and
patched by the parent agent): `adapterClaimsIsolatedContext` flipped to
the uniform fresh+session-id rule; hooks profile implemented
(scratch-cwd run dir with `.cursor/hooks.json` + embedded bun hook
script, failClosed on every gating entry, shell allowlist via
`beforeShellExecution`, Task deny via `preToolUse`, read-root gate via
`beforeReadFile`; worker config deny drops `Shell(**)` — the hook is the
shell authority — judge config deny unchanged); observed tool policy now
echoes the request like the incumbent adapters; ADR 0032 standing-gap
warnings replaced with the ADR 0034 disclosure notes; hook-blocked
`error` results ("blocked by a hook") count as denials while generic
errors still do not. Parent-agent review fixes: word-boundary allowlist
matching (`ls` must not admit `lsof`; exact match or prefix+space,
matching the OpenCode permission-map semantics) and an empty judge
shell allowlist (config `Shell(**)` deny is the judge authority; the
note no longer implies a judge allowlist). `bun test` 111 pass / 0
fail; typecheck clean; simplify considered (surgical fixes only).

Recorded phase-3 smoke: panel run
`fusion-28e7cf14-f853-4d1b-acf0-1cc314a97bfa` (two cursor workers
`cursor:auto` + `cursor:composer-2.5`, cursor judge, recorded) — panel
`ok`, **compliance tier `full`** with `isolatedContext: true` on both
workers; live enforcement evidence inside the run: `git status` allowed
by the hook allowlist, `echo` denied ("Shell command denied by Fusion
policy"), `/etc/hosts` read denied ("Read outside declared roots denied
by Fusion policy"), workers survived and disclosed all denials;
requested-id `auto` vs observed display-name `Auto` evidence intact.
Both degraded reasons from the phase-2 smoke are resolved.

Shell-cwd note: `git status` inside the smoke reported the repository
even though the process cwd is the scratch dir — the Shell tool appears
to execute relative to the workspace root, and `cat` in the allowlist
can read arbitrary paths shell-side. This is parity with the ADR 0022
allowlist on every harness (opencode's permission map allows `cat *`
too), not a cursor-specific regression; recorded as a cross-harness
follow-up question for the allowlist policy itself.

PR #4 review triage (2026-07-08): CodeRabbit (GitHub PR integration; the
CLI review hung and was abandoned) returned three findings. A recorded
Fusion cheap panel (`fusion-1299bc41-8b92-42e3-a467-395bb7a94a66`;
partial — the fable worker and judge failed on claude-code errors,
gpt-5.5 and deepseek completed) plus parent-agent verification judged
all three valid. The two ADR 0034 wording fixes landed (the fail-closed
evidence shows startup failure, not a crash; the `Shell(**)` prose
untangled). The major finding was real: the hook's prefix match admitted
compound commands (`git status && rm -rf /` passed
`startsWith("git status ")`) while the hook is the sole worker shell
authority. Fixed (Codex, parent-reviewed): the embedded hook script now
runs a quote-aware control-syntax scanner before prefix matching —
unquoted `;`, `&`, `|`, backtick, `<`, `>`, `$(`, and newlines deny,
while quoted metacharacters (`rg "a && b"`, `git log --grep="x|y"`) and
bare `$` stay allowed — with 17 new behavioral assertions; `bun test`
111 pass, typecheck clean. Parity verified from opencode source
(`packages/opencode/src/tool/shell.ts`): opencode tree-sitter-parses
compound commands and permission-checks each subcommand separately, so
it does NOT share this hole; the earlier `cat` parity note applies only
to single-command shell-side reads. New follow-ups: whether opencode's
`cmd *` pattern admits redirection on a single statement (`ls > file`),
and a probe for cursor `failClosed` on a hook that starts and then
crashes mid-run.

## Cursor Harness Round (2026-07-07): Phase 2 Implemented (Review Pending)

Phase 2 landed on `feature/cursor-harness` (implemented by Codex/GPT-5.5
from ADR 0030/0031/0032; committed and verified by the parent agent). All
phase-2 scope items shipped: `cursor` HarnessKind with `cursor:`-prefix-only
routing and `cursor-agent models` availability check (cli-transport
selection is a disclosed error), the ADR 0031 `PanelSpec.workers` /
`WorkerSlotPreference` migration with `modelPreferences` and
`fusionForcedHarnesses` removed shim-free, the cursor SDK adapter
(`lib/cursor-sdk-adapter.ts`: spawn + full stream parse + run-scoped
`CURSOR_CONFIG_DIR` deny injection + worker/judge profiles + standing gap
disclosures), judge eligibility, SKILL.md 0.8.0, schema regen. `bun test`
106 pass / 0 fail; typecheck clean.

Phase-2 verify results:

- `Read(**)` deny for the judge profile: **verified effective live**
  (cursor-agent 2026.07.01, Pro). A forced Read under the judge deny list
  returned `result.error.errorMessage: "Permission denied"`, the model never
  saw the file content, and the worker survived and disclosed. Note the
  denial arrives as an `error` result variant, NOT `permissionDenied`; the
  adapter recognizes the `error` variant (recorded as evidence, not counted
  as a denied request since `error` is not always a denial).
- Still open (carried forward): `Shell(command:args)` vs space syntax in
  allow entries (moot under the web-enabled profile, relevant if the
  no-`--force` profile returns), `CURSOR_CONFIG_DIR` merge-vs-replace,
  hooks.json Task interception feasibility.

Review: simplify considered (adapter matches house style; the
`unmappedPreferenceWarnings` triplication across adapters differs per
harness-mapped preferences and was left as an out-of-round refactor);
CodeRabbit reviewed the branch (1 minor finding — injected-config temp-dir
leak on writeFile failure — fixed).

Recorded smoke (ADR 0030 acceptance criteria 2-3): panel run
`fusion-94e9eb05-8a36-4020-bf9a-20092d92d850` (recorded under
`.fusion-runs/`) ran two cursor workers (`cursor:auto`,
`cursor:composer-2.5`) and a cursor judge (`cursor:composer-2.5`) — panel
`ok`, judge produced the five-key analysis with attribution, all required
provenance events present, requested-id vs observed-display-name evidence
recorded (`auto` / `Auto`), every standing gap disclosure present in worker
evidence and warnings, and compliance landed at the expected `degraded`
tier ("isolated context not proven; observed tool policy does not match
request"), consistent with ADR 0032's expected initial tier.

PR #3 CodeRabbit review triage (2026-07-08, recorded panel
`fusion-fbd4baae-e161-4ec2-9e87-5184e00f7e02`: gpt-5.5 + deepseek-v4-flash
via opencode + composer-2.5 via cursor, sonnet judge — first production use
of the cursor harness): 4 findings, none merge-blocking, unanimous across
workers. Dispositions: (1) "full-capable" wording — rejected; it is the
defined capability-class term from the "Full-Capable Harness Criteria"
section directly above, and the suggested rewording would erase the
deliberate full-vs-degraded distinction between OpenCode/Claude Code and
cursor; (2) executor-throw cleanup regression test — adopted in the PR;
(3) `LazyCursorModels`/`LazyOpenCodeModels` duplication — real but
deferred, consistent with the recorded `unmappedPreferenceWarnings`
precedent; extract a shared `LazyModelList` when a third copy appears
(e.g. the pi harness); (4) adapter-registry duplicate registered-checks —
rejected; the guards check different values (explicit preference vs
selector output), and if anything the two error messages should be
differentiated, not shared.

Remaining before merge: none blocking; merge when ready.

## Cursor Harness Round (2026-07-07): Phase 1 (Capability Probe) Complete

Adopts Cursor as the third reference harness (ADR 0030: kind renamed
`cursor-cli`→`cursor`, explicit `cursor:` prefix routing only, default
composition unchanged, judge-eligible, full tier a target not a gate,
independent of milestone 5). Grilled decisions also promoted per-worker
harness routing into the portable contract: `PanelSpec.workers?:
WorkerSlotPreference[]` (`{model?, harness?}`) replaces `modelPreferences`
and the untyped `fusionForcedHarnesses` userPolicy bag (ADR 0031). The
probe-informed transport and enforcement decisions are ADR 0032.

Probe (live, cursor-agent 2026.07.01-41b2de7; account upgraded Free→Pro
mid-probe after hitting the Free usage limit — the non-JSON
`ActionRequiredError` failure mode is itself a recorded finding):

- stream-json is Claude-Code-shaped and satisfies ADR 0028's
  protocol-surface `sdk` definition: init (session_id, model display name,
  permissionMode), tool_call started/completed with structured results
  (`success` / `rejected` / `permissionDenied` / `writePermissionDenied`),
  terminal result with usage tokens. Undocumented `thinking` / `connection`
  / `retry` events appear; parser must tolerate non-JSON lines.
- Enforcement recipe verified end to end: `CURSOR_CONFIG_DIR` (undocumented)
  injects a run-scoped `cli-config.json` without touching the user's global
  config or breaking login auth; headless default auto-rejects
  non-allowlisted shell without hanging and the worker survives and
  discloses (the ADR 0029 target semantics); `Write(**)` / `Delete(**)` /
  `Mcp(*)` denies hold, including under `--add-dir`.
- Hard limits found: deny precedence is absolute (specific allows cannot
  pierce `Shell(**)`), web tools run only under `--force`, so web tools and
  a shell allowlist are mutually exclusive; `--mode ask/plan` hard-rejects
  shell but does NOT hard-block edits (forced editToolCall wrote a real
  file); `Task` (subagents) is undeniable by any probed token; reads are
  open by default ($HOME readable, no workspace jail); untrusted dirs
  require `--trust`; 3 parallel spawns clean; `cursor-agent models`
  enumerates; init echoes the model display name, not the id.
- Decisions (ADR 0032): sdk-only adapter (no cursor CLI-transport path);
  worker profile = `--trust --force` + deny `Shell(**)/Write(**)/
  Delete(**)/Mcp(*)` (web on, shell off, divergences disclosed — upstream
  fidelity beat the local ADR 0022 allowlist when forced to choose); judge
  profile = no `--force` + the same denies plus `Read(**)` (untested,
  verify in phase 2); recursion denial stays prompt-level with a standing
  evidence gap (hooks.json interception is the follow-up); expected initial
  tier for cursor workers is `degraded`.

Phase 2 (implementation, Codex) scope: `cursor` in `HarnessKind` and
routing (`cursor:` prefix, `resolveModelEntry`, `cursor-agent models`
availability check), the ADR 0031 contract migration, the cursor SDK
adapter (spawn + full stream parse + config injection + display-name/id
evidence), judge eligibility (`isImplementedJudgeHarness`), SKILL.md bump,
schema regen. Phase 2 verify list: `Read(**)` deny for the judge profile,
`Shell(command:args)` vs space syntax in allow entries, whether
`CURSOR_CONFIG_DIR` merges with or replaces the user global config
(standing evidence note either way), hooks.json Task interception
feasibility. Acceptance criteria are enumerated in ADR 0030.

## SDK Transport Round (2026-07-06): Complete

Implements ADR 0028 (SDK transport default, transport axis, zero runtime
dependencies) and ADR 0029 (permission pre-decision, declared read roots).
Grilled decisions: scope = both harnesses; permission resolution =
deny-by-default with structured errors, with `readRoots` as the explicit
escape hatch; CLI adapters retained as `--transport cli` opt-in with no
automatic fallback; `HarnessDescriptor.transport` axis with `InvocationMode`
narrowed; dependency strategy = zero runtime deps with `@opencode-ai/sdk`
as a pinned type-only devDependency plus an import-guard test (a recorded
cheap-panel run unanimously endorsed zero-dep; the panel's blind spots —
server lifecycle, local server security, version probing — are recorded
below).

What landed:

- `opencode-sdk-adapter.ts`: raw HTTP/SSE client against a run-scoped
  self-spawned `opencode serve` (127.0.0.1, ephemeral port, one fresh-port
  respawn retry, 30s readiness, guaranteed reaping). Config injected via
  `OPENCODE_CONFIG_CONTENT`: a `fusion-worker` agent whose permission map
  realizes the read-only policy (bash command-pattern allowlist, wildcard
  deny elsewhere, `external_directory` globs from `readRoots`), plus the
  deprecated `experimental.continue_loop_on_deny` safety net. Observes
  model/usage/cost/session/tool events over SSE; auto-rejects unexpected
  permission asks; surfaces provider retry loops as warnings.
- `claude-code-sdk-adapter.ts`: same headless spawn, full stream-json
  parsing (session id, resolved model, usage, cost, num_turns,
  permission_denials), `--add-dir` from `readRoots`; corrected 2026-07-07 to
  place `--` before the positional prompt because `--add-dir` is variadic.
- CLI: `--transport sdk|cli` (default sdk, uniform for workers and judge),
  repeatable `--read-root`.

Live verification (all recorded or replayable):

- Milestone 6 repro: the exact recorded worker-2 request that
  deterministically dropped on the CLI path completed on the SDK transport
  (full answer, observed model and usage). Model substituted to
  `opencode/deepseek-v4-flash-free` because `opencode-go/deepseek-v4-flash`
  was in a provider-side retry outage that day.
- ADR 0029 both arms: config-denied external read surfaced as a
  model-visible tool error, loop continued, denial disclosed in the
  completed answer; the same read succeeded with the directory declared as
  a read root.
- SDK smoke panel (recorded): 3 workers + judge all `transport: "sdk"`,
  compliance tier `full` — the ADR 0022 degraded-compliance divergence is
  closed on the default transport. CLI opt-in smoke (recorded): workers and
  judge uniformly `"cli"`, degraded tier preserved.
- Reviews: CodeRabbit x3 (6 findings, then 2, all verified and fixed),
  live-run endpoint corrections (`/event` bare-Event stream, title-only
  session body, `msg_`-prefixed message ids, user-echo part filtering),
  and a simplify pass (dead code, arg-builder dedup, es2020 fix).

Mechanics and caveats learned live (also in ADR 0029 status):

- `external_directory` must be governed via the permission map only;
  putting it in the agent tools map blocks the read-root allows.
- OpenCode's enforcement boundary is its self-resolved project root, which
  can be wider than the declared workspace root; read roots govern only
  paths outside that resolved root.
- The injected config merges with the user's global opencode config, so
  effective permissions can be wider than declared — disclosed as a
  standing compliance-evidence note by the adapter.
- `opencode serve` runs unsecured on localhost (no
  `OPENCODE_SERVER_PASSWORD`); binding is 127.0.0.1-only. Hardening
  (password + auth header) is a follow-up candidate.
- Server startup can flake under rapid successive spawns; mitigated by the
  respawn retry.

## Upstream Fidelity Round (2026-07-06): Complete

Trigger: upstream re-research plus a recorded cheap-panel Fusion run
(gpt-5.5 / deepseek-v4-flash / grok-composer-2.5, judge fable, artifacts under
`.fusion-runs/`) re-examining the no-tools judge. Two decisions were grilled
and recorded:

- ADR 0026: the no-tools judge is kept as a deliberate, provisional
  divergence — upstream grants the judge `web_search`/`web_fetch` on both
  panel and judge calls, a fact ADR 0023/0024 had not recorded. The
  infrastructure rationales (permission-abort dropout risk, opencode tool
  policy unenforceable) expire with the SDK transport (milestone 1), which
  triggers a mandatory re-decision informed by a measured tools-on/tools-off
  judge-quality comparison (milestone 5). Split per-harness judge policy
  rejected for the provisional period; tool-free grounding reserved as a
  comparison-round arm. Upstream judge temperature 0 is recorded as an
  unmappable harness limitation, not a no-tools justification.
- ADR 0027: judge core validation must also accept exactly the documented
  upstream item shapes — `partial_coverage` `{models, point}`,
  `unique_insights` `{model, insight}`, contradiction stances
  `{model, stance}` — normalized into the existing internal types with
  best-effort attribution (model names resolved against
  `WorkerResult.modelUsed`; unresolvable/ambiguous names degrade to
  unattributed with a warning). ADR 0024's context misdescribed these
  sections as plain string arrays, and the current validator hard-fails
  faithful upstream shapes (`normalizeFinding` accepts only string/`{text}`)
  and silently drops stance `model` attribution. Acceptance stays exactly
  "our skeleton shapes ∪ documented upstream shapes"; everything else still
  fails. Types unchanged, so `schema:fusion` should be a no-diff check.

Docs updated in this round: ADR 0026/0027 added; ADR 0023/0024 status
back-references; spec (Reference Synthesis Policy), glossary (Harness-Backed
Judge, Judge Analysis), domain model (Synthesis).

Implementation (Codex, same day): `normalizeFinding` accepts the two
upstream finding shapes via section-scoped exact-key checks, `normalizeStance`
promotes a stance `model` to attribution when no explicit attribution is
present, and model names resolve against `WorkerResult.modelUsed` through an
exact-only ladder — raw exact, case-insensitive exact, provider-prefix-
stripped bare-name exact. Unknown or ambiguous names degrade to unattributed
with a warning. Worker model candidates are computed once per validation.

Review round: CodeRabbit reported zero findings on the initial diff; per the
comparison-shaped-task policy the zero-findings verdict was re-examined by a
recorded cheap Fusion panel (gpt-5.5 + grok-composer-2.5-fast effective;
deepseek dropped with invalid output), which unanimously overturned it. The
panel's confirmed Warning — a bidirectional containment tier silently
misattributed partial model names (`gpt-4` → `openai/gpt-4-turbo`) — was
fixed by removing the containment tier, plus the agreed simplification
(candidate hoisting). Skeleton `{ text }` objects keep tolerating extra keys:
ruled a pre-existing ADR 0024 tolerance, not an ADR 0027 boundary violation.
CodeRabbit re-ran clean on the final diff.

Verification: `bun test` 63 pass across 11 files (8 new fixtures),
`bun run typecheck:fusion` green, `bun run schema:fusion` semantically
no-diff (the regenerated files differ only in JSON formatting from the
checked-in prettier-style output — pre-existing toolchain quirk, schemas
restored to HEAD).

Loose ends noted for later rounds: the CLAUDE.md shorthand `-m
gpt,deepseek,composer` is not accepted by the model alias table (only
`openai-flagship`/`budget-smart` aliases exist; panels were run with
provider-qualified IDs), and deepseek-v4-flash-free produced invalid output
in this round's panel (cheap-worker dropout class, disclosed in the report).

## Current Status: Harness-Backed Judge Round Complete

The usable milestone (all four acceptance criteria from `docs/fusion/spec.md`)
was observed on this machine on 2026-07-05. After the judge round the
following were re-verified on the same day:

1. Default three-worker panel from a Claude Code parent (claude-code x1 +
   opencode x2), every worker `status: "ok"`, judge invocation `ok` via
   claude-code with a validated five-key analysis (attribution + quotes
   extensions present), zero warnings, correct Markdown report.
2. Panel invoked from an OpenCode parent with a claude-code worker included
   (verified at the usable milestone; not re-run after this round).
3. `bun test` (55 pass across 11 files), `bun run typecheck:fusion`, and
   `bun run schema:fusion` all green.
4. A `--record` run wrote the full split artifact set (8 files) under
   `.fusion-runs/<panelRunId>/` with `result.json` carrying
   `strategy: "claude-code"`, no `fallbackReason`, and the structured
   `analysis`.

## What Changed in the Harness-Backed Judge Round

Design (grilled, recorded in ADR 0023/0024 and the revised spec sections):

- The harness-backed judge is now the default synthesizer, closing the
  largest recorded divergence from upstream OpenRouter Fusion (three-stage:
  blind panel → separate judge comparison → parent agent authors the final
  answer). Judge model defaults to the parent model; `--judge-model
  <model-entry>` overrides via the same model-entry routing as panel
  composition. `--synthesizer parent-agent|deterministic` are explicit-only
  escapes.
- Judge output contract is an upstream-superset (ADR 0024): the five-key core
  (`consensus`, `contradictions` with `topic`/`stances`, `partial_coverage`,
  `unique_insights`, `blind_spots`) is validated after tolerant extraction;
  worker attribution and verbatim quotes are optional additive extensions,
  quote mismatches are warnings. No resolution field; judge runs with no
  tools.
- Judge failure follows upstream semantics: run stays `ok`, analysis omitted,
  warning disclosed, parent-agent authorship as fallback. Verified live: the
  first smoke run failed validation (judge invented a `stances_text` key) and
  fell back exactly as designed; the judge prompt now embeds an explicit JSON
  skeleton and the second smoke run validated cleanly.
- Judge provenance rides `synthesis.started`/`synthesis.completed` with
  model/harness/usage evidence; recorded runs include the judge request and
  result; compliance reports the judge separately (`judgeCompliance`).
- `PanelResult` gained `strategy` and `fallbackReason`; schemas regenerated
  (including new `judge-analysis` and `synthesis-result` schemas).

Implementation (delegated to Codex, reviewed and verified locally):

- New `skills/fusion/lib/judge-analysis.ts` (types, tolerant extraction,
  core validation, quote verification, Markdown rendering) and
  `skills/fusion/lib/judge-synthesizer.ts` (judge invocation through the
  worker adapter path, prompt with JSON skeleton, fallback handling).
- `test/runtime.test.ts` split into per-module test files plus shared
  `test/fixtures.ts` (11 files).
- CodeRabbit review ran (3 findings): 1 major falsified by subagent
  adjudication (proposed fix would have broken ADR 0023 fallback), 2 minor
  fixed (conflict-error wording, judge tools-policy note).
- Simplify round (4-angle subagent review) applied 13 cleanups: helper
  dedupe (`modelPreferenceToModel`, `normalizeHarnessDescriptor`,
  `errorMessage`), shared `describeJudgeInvocation` for event/compliance
  parity, single strategy-classification predicate, `PanelResult.strategy`
  propagation, elimination of a duplicate `opencode models` spawn at CLI
  startup, `buildWorkerRequestBase` extraction so judge requests inherit new
  worker fields automatically, no-tools deny list derived from defaults, and
  test fixture consolidation. Skipped by design: unifying judge harness
  selection into `buildJudgeRequest` (would change the documented
  `SynthesizerPreference` contract).
- `skills/fusion/SKILL.md` v0.7.0.

## What Changed in the Worker-Investigation Round

Root-cause finding: worker investigation effort was qualitatively lower than
the original OpenCode subagent Fusion not because of reasoning-effort settings
(those were commented out in the original), but because of (a) a
suppression-only prompt wrapper, (b) the output contract's `requiredSections`
never being rendered, (c) a narrower tool loadout without bash, and (d) no way
to pass conversation context to blind workers.

- `skills/fusion/lib/worker-prompt.ts` (new): `portableWorkerInstructions`
  (neutral-panelist norms ported from the OpenCode version — an explicit,
  revisitable trade-off against upstream fidelity, see ADR 0020) and
  `renderWorkerPrompt` producing the canonical
  `# Task / # Portable Worker Instructions / # Output Contract /
  # Shared Context` layout. Required sections and `schemaName` are rendered.
- Prompt rendering happens exactly once, in `buildWorkerRequests`; the CLI
  prepares worker requests up front, hashes the actual rendered prompt into
  the `ContextManifest` (with `userTask` recorded separately), and adapters
  send `WorkerRequest.prompt` verbatim.
- `ReasoningPreference` contract (ADR 0021): `--effort <low|medium|high|xhigh>`
  maps to `claude --effort` and `opencode --variant` (xhigh→max);
  `--reasoning-max-tokens` and `--max-turns` have no CLI mechanism on either
  harness today and surface as warnings, never silently dropped.
- Read-only bash allowlist (ADR 0022): `git status/diff/log`, `rg`, `grep`,
  `ls`, `cat`, enforced on claude-code via `--allowedTools Bash(<cmd>:*)`
  patterns under `--permission-mode dontAsk`. `sed` was deliberately excluded:
  prefix patterns cannot block `sed -i`. OpenCode still cannot enforce tool
  policy; that stays recorded degraded evidence.
- Shared-context path: `--context <text>` and repeatable
  `--context-file <path>` embed content for blind workers; >256KB embedded
  context warns.
- Claude stream parsing prefers the final `result` text over concatenated
  assistant parts, so mid-run narration no longer contaminates worker output.
- `skills/fusion/SKILL.md` v0.6.0 documents the new flags and tells the parent
  agent to pass context explicitly and raise `--effort` for high-stakes tasks.

Qualitative before/after comparison (same task, same single sonnet worker):
the new runtime fully honors the required output sections and cites broader
evidence (callers, tests, history-verification steps). Caveat: the comparison
task itself demanded citations, so it shows the lower bound of the
improvement; suppression effects are expected to matter more on vague tasks.

Review round: CodeRabbit ran on the uncommitted changes (4 major findings).
Subagent adjudication confirmed 1 (the `sed` hole, fixed), rated 1 partial
(`schemaName` not rendered — fixed defensively), and falsified 2 by direct
CLI verification (`opencode --variant` is silently ignored when unsupported;
`claude --effort xhigh` is a documented valid value on claude 2.1.201).

## What Exists Now

- `skills/fusion/bin/fusion-run.ts`: the bundled Bun CLI, the single canonical
  skill execution path (ADR 0014). Zero npm runtime dependencies; runs without
  `node_modules`. Markdown panel report on stdout by default, `--json` for the
  complete `PanelResult`. Exit code 0 for `ok`/`partial`, 1 for `failed`/usage
  errors.
- `skills/fusion/lib/panel-composition.ts`: default three-slot composition
  (parent model / `openai-flagship` / `budget-smart`), bundled alias table with
  ordered OpenAI-family and budget fallbacks, availability checks against
  `opencode models`, dedupe by resolved model ID with refill, and model-entry
  routing (`provider/model` → opencode, Claude aliases → claude-code,
  `opencode:`/`claude-code:` forced prefixes, unknown entries error) (ADR 0015).
- `skills/fusion/lib/headless-cli-adapters.ts`: adapters send the rendered
  prompt verbatim, map reasoning effort per harness, grant the bash allowlist
  on claude-code, and record unmapped preference warnings and compliance notes.
- Worker tool defaults: read-only local access, the read-only bash allowlist,
  plus WebSearch/WebFetch; edit/write/destructive/delegation tools denied
  (ADR 0018/0022).
- `skills/fusion/lib/judge-synthesizer.ts` + `judge-analysis.ts`: the default
  harness-backed judge — invocation through the worker adapter path, prompt
  with explicit JSON skeleton, tolerant extraction, strict five-key core
  validation, optional attribution/quote extensions with substring
  verification, Markdown rendering, and graceful fallback (ADR 0023/0024).
- Contract additions: `SynthesizerPreference`, `PanelRequest.synthesizer`,
  `PanelSpec.parentModel` (ADR 0016); `ReasoningPreference`,
  `PanelRequest.reasoning`, `WorkerRequest.reasoning` (ADR 0021);
  `JudgeAnalysis`, `SynthesisResult`, `PanelResult.strategy`/`fallbackReason`/
  `analysis`, `ComplianceSummary.judgeCompliance` (ADR 0023/0024); schemas
  regenerated.
- Partial-failure defaults are OpenRouter-aligned: `allowPartial: true`,
  continue-and-disclose, `failed` only when every worker fails (ADR 0019);
  judge failure keeps the run `ok` with the analysis omitted and disclosed
  (ADR 0023).
- `skills/fusion/SKILL.md` v0.7.0: CLI path, judge-backed synthesis by
  default, `--judge-model`, context/effort/budget flags, parent-agent
  guidance including read-tool verification before the final answer
  (ADR 0017/0020-0024).

## Smoke Procedure (re-runnable)

These are manual checks with real, paid model invocations.

```bash
# Criterion 3: library validation (free)
bun test && bun run typecheck:fusion && bun run schema:fusion

# Criteria 1 + 4: default panel from a Claude Code parent, with recording.
# The parent agent passes its own model id as --parent-model.
bun skills/fusion/bin/fusion-run.ts --parent-model fable --record \
  --timeout-ms 240000 \
  "Return exactly the string: fusion-smoke-ok. Do not add any other text."
# Expect: Run status ok; workers claude-code x1 + opencode x2 all ok;
# Judge: ok with a validated "## Judge Analysis" section and zero warnings;
# result.json carries strategy plus the structured analysis, no
# fallbackReason; 8 artifacts under .fusion-runs/<panelRunId>/ (request,
# manifest, events, worker-requests, worker-results, synthesis, compliance,
# result).

# Criterion 2: invocation from an OpenCode parent with a claude-code worker.
opencode run --model openai/gpt-5.5 'Use your bash tool to run this exact \
shell command from the current directory, wait for it to finish, then reply \
with only its "- Run status:" line and every "- Status:" line from stdout: \
bun skills/fusion/bin/fusion-run.ts --models sonnet,opencode/deepseek-v4-flash-free \
--timeout-ms 240000 "Return exactly the string: fusion-smoke-ok. Do not add any other text."'
# Expect: Run status ok; both workers ok.
```

`.fusion-runs/` must be git-ignored (it is, in the repo `.gitignore`); the file
recorder refuses to write otherwise without an explicit override.

## Known Limitations (honest state)

- Compliance tier reaches `full` on the default SDK transport (verified in
  the recorded SDK smoke). The `--transport cli` opt-in path remains
  `degraded`: the OpenCode CLI adapter still cannot prove tool-policy
  enforcement (ADR 0022, now scoped to that path only).
- `--reasoning-max-tokens` and `--max-turns` currently map to no harness CLI
  mechanism; they are honest warnings, not effective knobs, until the CLIs
  grow support.
- Non-default flags (`--effort`, `--context`, `--context-file`, `--max-turns`,
  `--reasoning-max-tokens`, `--judge-model`, `--synthesizer`) are unit-tested;
  only the default path (which now includes the judge) has been smoke-run
  end-to-end with real models. The 2026-07-07 Claude Code `--add-dir`
  separator fix was live-verified against claude 2.1.201 as a flag-contract
  probe and as a recorded full panel smoke (`fusion-18e68196-*`:
  claude-code workers plus claude-code judge with a declared read root, all
  ok, compliance tier `full` — the exact combination that previously failed
  deterministically).
- The alias table (`openai-flagship`, `budget-smart`) pins current model IDs;
  generation changes are absorbed by editing
  `skills/fusion/lib/panel-composition.ts` in a skill update.
- The judge is one invocation of the parent-model-by-default; a weak judge
  model degrades analysis quality. Judge validation failures fall back
  gracefully but forfeit the structured analysis for that run.
- The judge runs with no tools — a deliberate divergence whose re-decision
  duty fired when the SDK transport landed (ADR 0026); the re-decision is
  scheduled for the milestone 5 judge-quality comparison round with its
  measured tools-on/tools-off (and tool-free-grounding) arms as input.
- Judge model-name attribution resolution is exact-only (raw, then
  case-insensitive, then provider-prefix-stripped bare name); partial names
  like `gpt-4` against `openai/gpt-4-turbo` degrade to unattributed with a
  warning by design — a containment tier was implemented and then removed
  after a review panel showed it silently misattributes model variants.
- Judge quote verification is substring matching; paraphrased quotes surface
  as warnings even when semantically faithful.
- Forced per-worker harness routing now travels through the portable
  `PanelSpec.workers` / `WorkerSlotPreference` contract (ADR 0031, landed
  with cursor round phase 2); the `fusionForcedHarnesses` userPolicy bag is
  gone.
- Judge harness selection is resolved eagerly in the CLI
  (`resolveSynthesizerPreference`) rather than inside `buildJudgeRequest`;
  unifying it would change the documented `SynthesizerPreference` contract
  and was deliberately skipped in the simplify round.

## Next Milestones (reserved)

0. IN FLIGHT (2026-07-07, ADR 0030-0032): cursor harness round — phase 1
   (probe + decisions + docs) and phase 2 (implementation, on
   `feature/cursor-harness`) complete; review, recorded smokes, and merge
   pending. Independent of milestone 5.

1. DONE (2026-07-06, ADR 0028): SDK transport with tool-policy proof,
   session/tool-event capture, and programmatic permission handling; the
   recorded SDK smoke reached compliance tier `full`. The ADR 0026
   re-decision duty is now live and assigned to milestone 5.
2. CI automation of the smoke matrix plus flag-contract regression probes
   (needs credential management and paid calls in CI; deferred by the
   acceptance criteria). The probes should verify adapter-built argv against
   the actually installed CLI flag grammar; this incident showed that
   arg-building unit tests only encode our own assumptions.
3. Consider removing the emergency internal fallback once the skill matures
   (ADR 0017).
4. Revisit the portable-worker-instructions trade-off against upstream
   fidelity once upstream Fusion's prompt policy is observable again
   (ADR 0020). Upstream research (2026-07-05) confirmed the panel receives
   no output contract; the divergence is now known, not just suspected.
5. Judge-quality comparison round: same task with judge vs parent-agent
   synthesis to quantify the default's value (upstream DRACO methodology as
   reference). Also the mandatory measurement input for the ADR 0026 judge-
   tools re-decision (tools-on vs tools-off arms, plus the reserved
   tool-free-grounding arm).
6. DONE (2026-07-06, ADR 0029): the permission-abort dropout class is
   eliminated on the default transport via permission pre-decision plus
   declared read roots; the recorded worker-2 repro from
   `.fusion-runs/fusion-e7eb8340-*` (root cause: a permission-rejected
   `external_directory` read ended the headless turn without a final text
   step) now completes with the denial disclosed. The external-path stopgap
   is superseded: declare `--read-root` or inline the content. The CLI
   opt-in path retains the historical dropout behavior. Correction
   (2026-07-07): the claude-code arm was broken until this hotfix because
   variadic `--add-dir` swallowed the prompt; it was live-verified only then.

## Useful Commands

```bash
bun test
bun run typecheck:fusion
bun run schema:fusion
bun skills/fusion/bin/fusion-run.ts --help
opencode models
```
