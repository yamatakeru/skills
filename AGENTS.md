# リポジトリ概要

エージェント用 skill のリポジトリ。主な開発対象は `skills/fusion/` のブラインドパネル審議 CLI（Bun / TypeScript）。

## 作業の入口

- Fusion の利用・実行規約: [skills/fusion/SKILL.md](skills/fusion/SKILL.md)。CLI は `skills/fusion/bin/`、公開 API は `skills/fusion/lib/protocol.ts`、テストは `skills/fusion/test/`。
- 仕様・用語・設計変更: [spec.md](docs/fusion/spec.md)、[glossary.md](docs/fusion/glossary.md)、[domain-model.md](docs/fusion/domain-model.md) と関連する [ADR](docs/fusion/adr/) を読む。実機検証の手順は [runbook.md](docs/fusion/runbook.md)。
- `.agents/skills/` は導入済みの外部 skill（出所は `skills-lock.json`）。`.claude/skills/` はその symlink なので、コピーで置き換えない。

## 変更時の制約

- Fusion は skill ディレクトリ単体で動作させる。npm の実行時依存を追加しない。`@opencode-ai/sdk` は型のみの import に限る。
- `SKILL.md` に完全な実行規約を置き、`details/` を読まなくても動作する状態を保つ。振る舞いを変えたら、対応する仕様・利用説明・テストも更新する。
- `skills/fusion/schema/*.schema.json` は `skills/fusion/lib/types.ts` からの生成物。契約型を変えたら `bun run schema:fusion` で再生成し、差分を確認する。Schema は手編集しない。
- マージ済み ADR の決定内容は書き換えず、方針変更は新 ADR で supersede する。Status・相互参照の保守は可。
- `.fusion-runs/` は gitignore を維持する。実行記録を判断の根拠に使う場合、結論と必要な証拠を ADR 等に残し、ローカル成果物だけに依存させない。

## 検証

リポジトリルートで実行する。依存関係の導入は `bun install --frozen-lockfile`。

- コード変更: 関連テストを先に実行し、完了前に `bun test` と `bun run typecheck:fusion`。
- 文書のみの変更: 参照先・記載コマンドと実装の整合、`git diff --check` を確認する。全テストは不要。
- 通常検証では `FUSION_LIVE_TESTS` を未設定にする。`FUSION_LIVE_TESTS=1` のテストと実パネルは実モデルを呼び、課金・quota 消費があり得るため、通常テストの代わりに無条件で実行しない。

## レビュー

- 出荷する差分ごとに CodeRabbit レビューを少なくとも一度実施し、simplify（不要な複雑さ・重複の削減）を検討する。手順は [code-review skill](.agents/skills/code-review/SKILL.md)。同一差分への過度な反復は避ける。
- PR 作成後は最新 head のレビュー check 完了を待ち、Nitpicks を含む全指摘の妥当性を確認する。必要な修正と各指摘への返信を行い、未対応指摘がなくなるまで確認する。スレッドの返信は check 完了の代わりにしない。
