# Claude Code Instructions

本プロジェクトの開発ガイドはAGENTS.mdに統合されています。

@AGENTS.md

<!-- Claude Code固有の追加指示があればここに記載 -->

Use Fable for planning, coordination, deep analysis, and insight generation. Delegate lightweight research and cleanly scoped lightweight subtasks to Sonnet. Delegate heavy research, cleanly scoped heavy subtasks, and all implementation tasks—regardless of size or complexity—to Codex configured with GPT-5.5.

Give each subagent a clear goal, the relevant context, and what to bring back. Don't have them invent the plan. Run independent pieces in parallel.

When they return, review the results before you merge anything. If something's off, rewrite the brief and spin another, don't silently patch over it yourself unless it's trivial.
