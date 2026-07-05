# Fusion Runtime Handoff

Date: 2026-07-06 (upstream fidelity round — docs complete, implementation
pending)

This handoff captures the state of the Fusion runtime after the usable
milestone, the worker-investigation round, the harness-backed judge round
(judge as default synthesizer, upstream-superset judge output contract,
per-module test split, simplify cleanup), and the docs half of the upstream
fidelity round. The design authority is `docs/fusion/` (spec, domain model,
glossary, ADR 0001-0027).

## Upstream Fidelity Round (2026-07-06): Docs Done, Implementation Pending

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

Remaining work in this round (stopped deliberately before implementation for
a manual context compaction):

1. Delegate to Codex: implement ADR 0027 in
   `skills/fusion/lib/judge-analysis.ts` — extend `normalizeFinding` to
   accept the two upstream finding shapes, extend `normalizeStance` to
   promote `model` to attribution, add the model-name→workerId resolution
   helper using the `workerResults` already passed to
   `parseJudgeAnalysisOutput`, warnings per ADR 0027. Add
   `test/judge-analysis.test.ts` fixtures: the three upstream shapes pass
   (with resolved attribution), ambiguous/unknown model names warn without
   failing, unrelated object shapes still fail.
2. CodeRabbit review on the diff (AGENTS.md requires at least one per
   implementation task) plus a simplify pass consideration.
3. Verify: `bun test`, `bun run typecheck:fusion`, `bun run schema:fusion`
   (expect no schema diff), then one cheap `--record` live smoke to confirm
   the default path is unaffected (upstream shapes themselves are covered by
   unit fixtures only).

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

- Compliance tier is `degraded`, not `full`: the OpenCode CLI adapter cannot
  yet prove effective tool-policy enforcement, and neither adapter provides
  full session/tool-event evidence. Full compliance was not claimed.
- `--reasoning-max-tokens` and `--max-turns` currently map to no harness CLI
  mechanism; they are honest warnings, not effective knobs, until the CLIs
  grow support.
- Non-default flags (`--effort`, `--context`, `--context-file`, `--max-turns`,
  `--reasoning-max-tokens`, `--judge-model`, `--synthesizer`) are unit-tested;
  only the default path (which now includes the judge) has been smoke-run
  end-to-end with real models.
- The alias table (`openai-flagship`, `budget-smart`) pins current model IDs;
  generation changes are absorbed by editing
  `skills/fusion/lib/panel-composition.ts` in a skill update.
- The judge is one invocation of the parent-model-by-default; a weak judge
  model degrades analysis quality. Judge validation failures fall back
  gracefully but forfeit the structured analysis for that run.
- The judge runs with no tools — a deliberate, provisional divergence from
  upstream's web-tools judge with a mandatory re-decision when the SDK
  transport lands (ADR 0026).
- Until the ADR 0027 implementation lands, judge core validation hard-fails
  faithful upstream-shaped `partial_coverage`/`unique_insights` items and
  silently drops stance `model` attribution.
- Judge quote verification is substring matching; paraphrased quotes surface
  as warnings even when semantically faithful.
- Forced per-worker harness routing travels through
  `harnessSelectionPolicy.userPolicy.fusionForcedHarnesses` because `PanelSpec`
  has no per-worker harness field; revisit if the portable contract grows one.
- Judge harness selection is resolved eagerly in the CLI
  (`resolveSynthesizerPreference`) rather than inside `buildJudgeRequest`;
  unifying it would change the documented `SynthesizerPreference` contract
  and was deliberately skipped in the simplify round.

## Next Milestones (reserved)

1. Stronger compliance evidence toward `full` tier: tool-policy proof for
   OpenCode workers, session/tool-event capture, SDK transports where they
   provide better evidence. SDK transport must also handle worker permission
   requests programmatically; the CLI path's auto-reject currently aborts
   the agent loop and drops the worker (see milestone 6). Landing this
   expires the infrastructure rationales of ADR 0026 and triggers the
   mandatory re-decision on judge tools.
2. CI automation of the smoke matrix (needs credential management and paid
   calls in CI; deferred by the acceptance criteria).
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
6. Fix OpenCode worker dropouts caused by permission auto-reject aborting
   the agent loop. Root cause diagnosed 2026-07-06 by replaying the recorded
   worker-2 prompt from `.fusion-runs/fusion-e7eb8340-*`: when a worker's
   tool call is permission-rejected (here an `external_directory` read of a
   path mentioned in the shared context), headless `opencode run` ends the
   turn at `step_finish reason: tool-calls` without a final text step and
   exits 0, so the adapter reports "opencode returned invalid JSON output:
   no result text found". Controls: a successful tool call continues to a
   text-bearing second step; a single rejected call reproduces the dropout
   deterministically. This corrects the earlier output-format-incompatibility
   hypothesis; model dependence (`deepseek-v4-flash` 2/2, `grok-composer-2.5-fast`
   1/2 failed, `gpt-5.5` 0/2) reflects only how eagerly each model reads
   external paths. The durable fix belongs in the SDK-transport work
   (milestone 1): handle permission requests programmatically — pre-grant
   the read-only policy or return denials to the model as structured tool
   errors so the loop continues. Avoiding external-path mentions in worker
   context is a stopgap only. The same dogfooding runs also produced the
   first live judge-quote verification warning (ADR 0024 substring check
   caught a fabricated quote); artifacts are under `.fusion-runs/`.

## Useful Commands

```bash
bun test
bun run typecheck:fusion
bun run schema:fusion
bun skills/fusion/bin/fusion-run.ts --help
opencode models
```
