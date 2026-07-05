# Fusion Runtime Handoff

Date: 2026-07-05 (worker-investigation round)

This handoff captures the state of the Fusion runtime after the usable
milestone and the follow-up worker-investigation round (portable worker
instructions, reasoning pass-through, read-only bash, shared-context flags).
The design authority is `docs/fusion/` (spec, domain model, glossary,
ADR 0001-0022).

## Current Status: Usable Milestone + Worker-Investigation Round

The usable milestone (all four acceptance criteria from `docs/fusion/spec.md`)
was observed on this machine on 2026-07-05. After the worker-investigation
round the following were re-verified on the same day:

1. Default three-worker panel from a Claude Code parent (claude-code x1 +
   opencode x2), every worker `status: "ok"`, correct Markdown report.
2. Panel invoked from an OpenCode parent with a claude-code worker included
   (verified at the usable milestone; not re-run after this round).
3. `bun test` (42 pass), `bun run typecheck:fusion`, and `bun run schema:fusion`
   all green.
4. A `--record` run wrote the full split artifact set (8 files) under
   `.fusion-runs/<panelRunId>/`, and the recorded `ContextManifest` hash
   (fnv1a32) was independently recomputed from the rendered prompt and matched.

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
- Contract additions: `SynthesizerPreference`, `PanelRequest.synthesizer`,
  `PanelSpec.parentModel` (ADR 0016); `ReasoningPreference`,
  `PanelRequest.reasoning`, `WorkerRequest.reasoning` (ADR 0021); schemas
  regenerated.
- Partial-failure defaults are OpenRouter-aligned: `allowPartial: true`,
  continue-and-disclose, `failed` only when every worker fails (ADR 0019).
- `skills/fusion/SKILL.md` v0.6.0: CLI path and parent-agent synthesis, new
  context/effort/budget flags, parent-agent guidance (ADR 0017/0020-0022).

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
# 8 artifacts under .fusion-runs/<panelRunId>/ (request, manifest, events,
# worker-requests, worker-results, synthesis, compliance, result).

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
- New flags (`--effort`, `--context`, `--context-file`, `--max-turns`,
  `--reasoning-max-tokens`) are unit-tested; only the default path has been
  smoke-run end-to-end with real models.
- The alias table (`openai-flagship`, `budget-smart`) pins current model IDs;
  generation changes are absorbed by editing
  `skills/fusion/lib/panel-composition.ts` in a skill update.
- `--synthesizer` accepts `parent-agent` (default) and `deterministic`;
  harness-kind values error as not implemented (contract-reserved).
- Forced per-worker harness routing travels through
  `harnessSelectionPolicy.userPolicy.fusionForcedHarnesses` because `PanelSpec`
  has no per-worker harness field; revisit if the portable contract grows one.
- The deterministic synthesis in the report is an audit reference; answer
  quality depends on the parent agent authoring the five-finding synthesis.

## Next Milestones (reserved)

1. Harness-backed judge: implement `--synthesizer <harness-kind>` as a separate
   worker invocation with its own provenance and evidence (ADR 0016).
2. CI automation of the smoke matrix (needs credential management and paid
   calls in CI; deferred by the acceptance criteria).
3. Stronger compliance evidence toward `full` tier: tool-policy proof for
   OpenCode workers, session/tool-event capture, SDK transports where they
   provide better evidence.
4. Consider removing the emergency internal fallback once the skill matures
   (ADR 0017).
5. Revisit the portable-worker-instructions trade-off against upstream
   fidelity once upstream Fusion's prompt policy is observable again
   (ADR 0020).

## Useful Commands

```bash
bun test
bun run typecheck:fusion
bun run schema:fusion
bun skills/fusion/bin/fusion-run.ts --help
opencode models
```
