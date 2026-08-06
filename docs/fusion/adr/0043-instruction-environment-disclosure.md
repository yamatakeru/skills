# ADR 0043: Instruction Environment Disclosure Uniformity

## Status

Accepted

## Context

Decided 2026-08-06 in a grilled maintainer session (issue #17, P1-1), after
an external report questioned how harness-injected persistent instructions
interact with the blind-panel contract. Two recorded panels informed the
decisions: a validity review of the report (`fusion-5bc8c671-*`) and a
disclosure-surface design review (`fusion-c9338de8-*`, partial — the opus
worker timed out mid-answer; its completed sections agree with the parts of
the consensus it reached).

Verified facts:

- Every harness injects a persistent instruction layer from outside the
  rendered prompt — the Instruction Environment (glossary). claude-code loads
  user-level memory (`~/.claude/CLAUDE.md` and its imports) and project-level
  memory (`CLAUDE.md` resolved from the session cwd, plus imports) on both
  transports: `buildClaudeCodeSdkArgs` returns the CLI argv unchanged and the
  worker cwd is the workspace root. opencode merges user-level config
  (instructions, global rule files) and can load project `AGENTS.md`; its CLI
  transport passes `--pure`, whose suppression semantics are unverified,
  while the SDK `serve` path does not pass it. cursor blocks the project
  layer via the scratch cwd, but account User Rules inject regardless
  (ADR 0034) — until this ADR, cursor was the only harness with a standing
  disclosure.
- The judge runs through the same adapter path with the same environment
  (`buildWorkerRequestBase`), so every channel above applies to judge
  invocations too.
- Worker adapter notes reach the result surface as
  `PanelResult.workerResults[].complianceEvidence.notes`. Judge notes exist
  only inside `SynthesisResult.judgeResult`, which is not part of
  `PanelResult`: `--json` output and non-recorded runs have no reachable
  judge disclosure at all. `evaluateJudgeCompliance` generates two fixed
  notes and reads no adapter evidence.
- ADR 0033 already places environment-cleanliness facts in compliance
  evidence notes, outside isolation claims and tiers.

## Decision

Instruction Environment disclosure becomes uniform across harnesses and
invocations:

1. **Static standing disclosure.** Notes state capability-level facts that
   hold for the harness and transport; the runtime never detects whether the
   underlying files exist or what they contain.
2. **One central helper as the wording authority.** A shared
   `instructionEnvironmentDisclosures(harness)` definition supplies every
   surface: adapters append its lines to `complianceEvidence.notes` (reaching
   workers and judge automatically), and `evaluateJudgeCompliance` appends
   the same lines to `JudgeCompliance.notes` by regenerating them from the
   judge's harness and transport — not by filtering result notes. The lift
   tolerates a missing `judgeResult` or `complianceEvidence` (judge-failure
   fallback). No `WorkerCompliance.notes` field is added. The default
   Markdown report renders one mandatory header line, deduplicated by
   harness/transport across workers and the judge.
3. **Disclosed fact ranges.** claude-code: user- and project-level memory
   injection asserted, both transports. opencode SDK: capability-level
   ("can receive" user-level instructions, global rule files, project
   `AGENTS.md`). opencode CLI: `--pure` is passed and its suppression effect
   is unverified. cursor: existing disclosure unchanged.
4. **Recorded rationale for the judge lift.** The asymmetry against workers
   compensates for the structural absence of judge primary evidence from the
   result surface (`PanelResult` / `--json`), not "nesting depth".
   `WorkerCompliance.notes` is rejected because duplicating adjacent
   `workerResults` evidence has no benefit and `WorkerCompliance` lacks
   harness context to interpret a disclosure — not because of schema cost
   (schemas are generated; optional additions are cheap).
5. **SKILL.md documents the per-harness standing facts once**, in Worker
   Rules; the helper remains the wording authority so SKILL.md, notes, the
   judge summary, and the report line cannot drift independently.

Rejected and deferred:

- Compliance tiers and isolation claims remain unaffected (ADR 0033). Any
  future gate must arrive as a new independent evidence dimension applied to
  all harnesses.
- A structured `instructionEnvironment?: string[]` evidence field is
  deferred. It is recorded as the anticipated disclosure-only precursor
  shape of that future dimension.
- Recording injected content — verbatim, hashed, or as runtime
  existence-detection results — is prohibited. This privacy constraint is
  also why the disclosure is static.

## Consequences

- Cursor's standing-disclosure precedent generalizes; all harnesses and the
  judge disclose uniformly, and issue #17 phase 2 (launch-time blocking
  probes) can narrow the disclosed facts by updating the helper.
- Non-recorded runs expose judge disclosures through
  `JudgeCompliance.notes`; auditors keep `worker-results.json` /
  `synthesis.json` as primary sources with `compliance.json` as a derived
  view whose disclosure lines are regenerated, so they cannot drift from the
  adapter-attached evidence.
- The default Markdown report gains one bounded line, honoring ADR 0038's
  expectation that separate-axis facts stay visible on the report surface
  (the containment header line is the precedent).
- No schema changes: `JudgeCompliance.notes` already exists and
  `WorkerCompliance` is untouched.
