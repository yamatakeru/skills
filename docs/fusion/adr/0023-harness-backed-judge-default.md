# ADR 0023: Harness-Backed Judge as Default Synthesizer

## Status

Accepted

Divergence inventory corrected by ADR 0026: the no-tools judge is a further
deliberate divergence from upstream, unrecorded when this ADR was written.

## Context

ADR 0016 deferred the harness-backed judge and let the parent agent author
both the synthesis and the final answer in the usable milestone. That merged
two roles that upstream OpenRouter Fusion keeps separate.

A web research round against the upstream documentation (blog announcement
2026-06-12; plugin, server-tool, and fusion-router docs, retrieved 2026-07-05)
established the upstream architecture precisely:

- The panel answers in parallel; "The **judge** receives all panel responses
  ... and compares them — it doesn't merge them."
- "Your model receives the structured analysis and writes the final answer" —
  the calling (outer) model, not the judge, authors the final answer.
- In the server-tool form the judge model defaults to the outer model itself.
- "If the **panel** succeeds but the **judge** fails ... the tool does **not**
  error. It returns `status: "ok"` with the raw panel `responses` and simply
  **omits** `analysis`."

Our parent-agent default therefore carried the largest remaining deliberate
divergence from upstream: no independent judge invocation. The
`SynthesizerPreference` contract and the worker adapter infrastructure
(headless CLI adapters, provenance events, run recording) already exist, so
the implementation cost that justified deferral in ADR 0016 has largely been
paid.

## Decision

The harness-backed judge becomes the default synthesizer.

- A default run executes the panel, then one additional judge invocation that
  produces the structured comparison analysis. The parent agent still authors
  the final answer, grounded in the judge analysis (upstream outer-model
  authorship is preserved).
- The judge model defaults to the parent model (matching upstream's
  judge-defaults-to-outer-model behavior). A new `--judge-model
  <model-entry>` option overrides it, resolved through the same model-entry
  routing as panel composition (Claude aliases to claude-code,
  `provider/model` to opencode, forcing prefixes allowed). This maps to
  `SynthesizerPreference.model`; `--synthesizer` remains for strategy escape.
  If neither `--parent-model` nor `--judge-model` is supplied, the judge
  falls back to the selected harness's default model and the CLI emits a
  warning disclosing the fallback.
- `parent-agent` and `deterministic` remain implemented strategies but are
  explicit-only: they run when the user passes `--synthesizer parent-agent`
  or `--synthesizer deterministic`, never as a silent default.
- Judge failure (invocation error, timeout, or invalid output) follows
  upstream semantics: the panel result stays `ok`, the judge analysis is
  omitted, the failure is disclosed as a warning, and the parent agent falls
  back to authoring the synthesis from raw worker outputs (the previous
  parent-agent flow).
- The judge invocation reuses the worker adapter path (`WorkerRequest`
  through the headless CLI adapters) with its own provenance: the existing
  `synthesis.started` / `synthesis.completed` events carry the judge's
  strategy, model, harness, and usage evidence, and recorded artifacts
  include the judge request and result.
- The panel-wide `--timeout-ms` and `ReasoningPreference` (`--effort`,
  `--reasoning-max-tokens`) apply to the judge invocation as well, mirroring
  upstream's forwarding of `temperature`/`reasoning` to the fusion tool.
- The judge is not a blind panel worker: it must see all worker outputs, and
  compliance reporting records it separately from panel workers. Blindness
  and dedupe rules do not apply to it; recursion denial does (a judge cannot
  spawn panels).
- The deterministic synthesizer is retained. When the judge succeeds, its
  output is demoted to recorded artifacts only (audit reference); when the
  judge fails or an explicit non-judge strategy is chosen, it stays in the
  panel report as before.

## Consequences

- A default run now costs one additional model invocation and its latency.
  This reverses the ADR 0016 cost call deliberately: the judge is the
  upstream architecture, and the usable milestone that justified deferral is
  complete.
- The largest recorded divergence from upstream OpenRouter Fusion is closed.
  Remaining recorded divergences: portable worker instructions (ADR 0020,
  strengthened for revisit — upstream research confirmed the panel gets no
  output contract) and degraded compliance evidence (ADR 0007/0022).
- Synthesis quality no longer depends solely on the parent agent; judge
  independence can now be claimed and evidenced through provenance.
- `SKILL.md` guidance changes: the parent agent receives a judge analysis by
  default and is instructed to verify load-bearing claims with its own read
  tools before writing the final answer.
- Judge failure semantics keep runs useful without a judge, so harness
  flakiness cannot make Fusion worse than the pre-judge behavior.
