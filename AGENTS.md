# リポジトリ概要

エージェント用 skill のリポジトリ。主な開発対象は `skills/fusion/` のブラインドパネル審議 CLI（Bun / TypeScript）。

## 作業の入口

- Fusion の利用・実行規約: [skills/fusion/SKILL.md](skills/fusion/SKILL.md)。CLI は `skills/fusion/bin/`、公開 API は `skills/fusion/lib/protocol.ts`、テストは `skills/fusion/test/`。
- 仕様・用語・設計変更: [spec.md](docs/fusion/spec.md)、[glossary.md](docs/fusion/glossary.md)、[domain-model.md](docs/fusion/domain-model.md) と関連する [ADR](docs/fusion/adr/) を読む。実機検証の手順は [runbook.md](docs/fusion/runbook.md)。
- `.agents/skills/` は導入済みの外部 skill（出所は `skills-lock.json`）。`.claude/skills/` はその symlink なので、コピーで置き換えない。

## 変更時の制約

- Fusion は skill ディレクトリ単体で動作させる。npm の実行時依存を追加しない。`@opencode/client` は型のみの import に限る（ADR 0046）。
- `SKILL.md` は呼び出し側エージェント向けのガイドとし、実行・最終回答に必要な事項（使う場面、起動方法と渡す文脈、レポートの読み方、守るべき不変条件、Gotchas、縮退時の扱い）を置いて、`details/` を読まなくても正しく使える状態を保つ。CLI が強制・開示する内部仕様は `details/` に置き、`SKILL.md` から読むべき状況を添えて 1 階層で参照する。バージョン範囲や移行経緯は本文に書かない（[ADR 0052](docs/fusion/adr/0052-skill-md-parent-guide-progressive-disclosure.md)）。
- 実運用で見つかった落とし穴は `SKILL.md` の Gotchas に追記する。振る舞いを変えたら、呼び出し側の行動が変わる場合は `SKILL.md` を、そうでなければ `details/`・仕様・テストを更新する。
- `skills/fusion/schema/*.schema.json` は `skills/fusion/lib/types.ts` からの生成物。契約型を変えたら `bun run schema:fusion` で再生成し、差分を確認する。Schema は手編集しない。
- マージ済み ADR の決定内容は書き換えず、方針変更は新 ADR で supersede する。Status・相互参照の保守は可。
- `.fusion-runs/` は gitignore を維持する。実行記録を判断の根拠に使う場合、結論と必要な証拠を ADR 等に残し、ローカル成果物だけに依存させない。

## 検証

リポジトリルートで実行する。依存関係の導入は `bun install --frozen-lockfile`。

- コード変更: 関連テストを先に実行し、完了前に `bun test` と `bun run typecheck:fusion`。
- 文書のみの変更: 参照先・記載コマンドと実装の整合、`git diff --check` を確認する。全テストは不要。
- 通常検証では `FUSION_LIVE_TESTS` を未設定にする。`FUSION_LIVE_TESTS=1` のテストと実パネルは実モデルを呼び、課金・quota 消費があり得るため、通常テストの代わりに無条件で実行しない。
