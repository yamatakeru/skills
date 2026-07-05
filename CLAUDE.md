# Claude Code Instructions

本プロジェクトの開発ガイドはAGENTS.mdに統合されています。

@AGENTS.md

<!-- Claude Code固有の追加指示があればここに記載 -->

Use Fable for planning, coordination, deep analysis, and insight generation. Delegate lightweight research, mechanical edits, and cleanly scoped lightweight subtasks to Sonnet. Delegate heavy research, cleanly scoped heavy subtasks, and all implementation tasks—regardless of size or complexity—to Codex configured with GPT-5.5. Reserve an Opus subagent for work where a single Claude-authored voice is the point—a language-sensitive JP/EN synthesis, a delicate rewrite, a tone- or values-calibration read, or a fast inline critique on a narrow question—cases where blending several workers through a judge would dilute the voice or cost latency you can't spare.

When a task is comparison-shaped—critique, review, or a second opinion where independent perspectives are likely to change or sharpen the conclusion—prefer a Fusion blind panel (the bundled `skills/fusion` CLI): independent workers plus a harness-backed judge surface consensus, contradictions, partial coverage, unique insights, and blind spots, and Fable authors the final answer from the judge analysis, verifying load-bearing quotes with read tools. Match the panel to the stakes: cheap-model panels (e.g. gpt/deepseek/composer through OpenCode) cost little under current subscriptions and may be used casually for deep research, design exploration, and review-angle sweeps; reserve flagship-mixed panels for high-stakes or hard-to-reverse decisions. A single Opus pass is the fallback only for the narrow seat above—voice, nuance, or a latency-bound inline read—since for any other second opinion a cheap panel wins on cost, quota, and (on breadth-bound work) coverage.

Fusion is deliberation, not implementation—implementation still goes to Codex. A panel's real costs are latency, occasional cheap-worker dropouts, and Fable's attention, not fees: skip Fusion for routine edits, single-source lookups, and tasks where independent reasoning would not change the outcome; partial runs are disclosed and usually still usable. While the skill is developed in parallel with real use, run panels with `--record` so live artifacts feed the compliance-evidence and judge-quality milestones.

Delegation is the default for breadth: sweeping, triaging, and filtering many sources is subagent work. Depth is the narrow exception: when an analysis or decision rests on a small number of primary sources, Fable reads those few directly instead of reasoning over secondhand summaries. Keep that set small and curated—Fable's own context is the scarce resource, reserved for cases where a summary's omissions would change the conclusion.

Give each subagent a clear goal, the relevant context, and what to bring back. For research tasks, have them return pointers (paths, URLs, section names) to the load-bearing sources and verbatim quotes of the decisive passages alongside their conclusions—subagent tokens are cheap, Fable's are not, so err on the side of quoting more. Don't have them invent the plan. Run independent pieces in parallel.

When they return, review the results before you merge anything. If something's off, rewrite the brief and spin another, don't silently patch over it yourself unless it's trivial.
