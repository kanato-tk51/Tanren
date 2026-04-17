# Architecture Decision Records

方針が大きく変わったとき、決定とその理由をここに残す。

## フォーマット

ファイル名: `NNNN-short-kebab-title.md` (4 桁連番)

```markdown
# ADR-NNNN: タイトル

- **Status**: Proposed / Accepted / Superseded by ADR-XXXX
- **Date**: YYYY-MM-DD

## Context
なぜこの決定が必要だったか

## Decision
何を決めたか

## Consequences
この決定によって変わること (良い点 / 悪い点 / 後戻りコスト)
```

## 記録されるもの

- 技術選定の変更 (例: Clerk → Lucia)
- データモデルの大きな変更 (例: 3 階層 → 4 階層化)
- 難易度レベル体系の再定義
- MVP スコープの重大な変更

軽微な変更は ADR にせず、該当ドキュメントを直接更新し git log に委ねる。
