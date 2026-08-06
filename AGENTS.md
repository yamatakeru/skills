## 開発フロー

- レビューでは最低限simplifyを検討する。また、一つの実装タスクに対し、少なくとも一度はCodeRabbitによるcode-reviewを実施する。ただし、CodeRabbitのレートリミット、およびレビュー全般におけるトークンコストと効用のトレードオフを考慮し、同一差分への過度な反復レビューは避ける。
- 仕様の前提を覆す発見やユーザー判断を要する重大な指摘があった場合は、対応前にユーザーへ報告して指示を仰ぐ。対応後は、該当箇所に限って再レビューする。
- レビュー指摘の常設処置先例: 「未来日付」クラス（レビュアーのUTC評価とメンテナのローカル日付の差に起因）は却下する。ADRのdecided dateとgrilled session出所の記載は本リポジトリの様式であり、削除提案は採らない。マージ済みADRの決定内容は不変（方針変更は新ADRでsupersede）だが、Statusへのback-reference追記や参照先の保守といったメタデータ編集は先例（ADR 0023/0024/0026/0029）に基づき可。
- PR作成後はConversation上でレビューが実行される。自動レビューはpushごとにhead commitのcheckとして走るため、その指摘の収集はcheckの完了を待ってから行う（スレッドへの解決返信の新着は完了シグナルではない）。Nitpicksを含むすべての指摘について妥当性を確認し（必要に応じてサブエージェントを使う）、必要な修正を行い、各指摘への対応をコメントで返す。これを指摘がなくなるまで繰り返す。

## GitHub issue運用

- 複数changeにまたがる可変の状態（実施順序の依存関係・並列可能性・起票予定・進捗）は統括issueで管理する。PR連動とクローズにより状態の鮮度が自動で保たれるためで、キャンペーン作業の着手時はまず統括issueを読む。
- 不変の確定判断（却下済み案と理由、設計根拠）はリポジトリ内文書に置く。issueは新セッションで自動では読まれない。
- 恒久文書（ADR等）は自己完結したdurable recordとして書く（ADR 0042の原則: 裏付け成果物が揮発性なら、文書自身が耐久記録になる）。恒久文書からの参照は安定アドレス（他のADR・docs/配下・コードパス・issue番号・イミュータブルなcommit permalink）に限る。gitignoreされた成果物や記録run idは出所表示としてのみ引用し、load-bearingな内容の唯一の置き場にしない。揮発性・一時ファイル（ハンドオフ類）への参照は禁止。番号付き予約milestoneのような「ADRから引用される番号空間」の定義はin-repoレジストリ（例: docs/fusion/milestones.md）に置き、issueには進捗のみを置く。

## 並列実装（git worktree戦略）

複数の独立したchangeを一括実装する場合（この一括実装の単位をwaveと呼ぶ）は、集約ブランチ（例: feature/wave-N）を切り、changeごとにワークツリーを分離して並列実装する。実装の委譲先（実装ワーカー）は各ハーネスの委譲方針に従う。

- `git worktree add ../<repo>-<略称> -b <changeブランチ> <集約ブランチ>` で分離し、実装は各ワークツリー内で実装ワーカーへ委譲する。
- 書き込み許可がワークツリー配下に限定されたsandboxワーカーは、実Git metadata（本体側 .git/worktrees/）へ書けずコミットできない。コミットは親エージェントが検証（pytest / openspec validate）後に行う。
- ワークツリー内の品質ゲートはこの機械検証（pytest / openspec validate）のみとする。ブランチ単体の状態は出荷されないため、そこへのレビュー投資は不要。
- 委譲ジョブの実行権限（書き込み可能領域）・状態・成果物は起動時のワークツリー（cwd）に紐づくことがある。起動・状態確認・結果取得は必ず該当ワークツリー内から行う。
- 同一ファイルを触るchange群でも並列してよいが、コンフリクト解消は集約時に親が行い、統合後に全テストと全changeのvalidateを再実行する。
- CodeRabbitレビューとsimplify検討は、マージ集約・統合検証後に統合差分へ一括実行する（親環境で `coderabbit review --agent -t committed --base <PR基点ブランチ>`）。統合差分は各changeの差分を含むため「実装タスクごとに最低1回」を満たし、コンフリクト解消箇所とchange横断の重複も射程に入り、レートリミット消費も抑えられる。指摘対応後にPRを立て、PR時のConversationレビューはセーフティネットとして従来どおり実施する。
- マージ後は `git worktree remove` とブランチ削除で後片付けする。

## Fusion（ブラインドパネル審議）

When a task is comparison-shaped—critique, review, or a second opinion where independent perspectives are likely to change or sharpen the conclusion—prefer a Fusion blind panel (the bundled `skills/fusion` CLI): independent workers plus a harness-backed judge surface consensus, contradictions, partial coverage, unique insights, and blind spots, and the parent agent authors the final answer from the judge analysis, verifying load-bearing quotes with read tools. Match the panel to the stakes: cheap-model panels (e.g. gpt-5.6-sol/deepseek-v4-flash/composer-2.5 or cursor:grok-4.5 through OpenCode) cost little under current subscriptions and may be used casually for deep research, design exploration, and review-angle sweeps; reserve flagship-mixed panels for high-stakes or hard-to-reverse decisions. Work whose deliverable is a single authored voice, language-sensitive nuance, or a latency-bound read stays outside Fusion—a single strong pass serves it better than judge-stitched consensus.

Fusion is deliberation, not implementation—implementation still goes through your harness's normal implementation workflow. A panel's real costs are latency, occasional cheap-worker dropouts, and the parent agent's attention, not fees: skip Fusion for routine edits, single-source lookups, and tasks where independent reasoning would not change the outcome; partial runs are disclosed and usually still usable. While the skill is developed in parallel with real use, run panels with `--record` so live artifacts feed the compliance-evidence and judge-quality milestones.
