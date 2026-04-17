# ADR-0001: 難易度レベルを 6 段階に統一

- **Status**: Accepted
- **Date**: 2026-04-17

## Context

初期のドラフトでは 2 系統の難易度が並走していた:

1. **concept 内の段階**: `intro / applied / edge_case` (concept の深さ)
2. **ユーザー難易度**: `beginner / junior / mid / senior / staff / principal` (読み手レベル)

これが `concepts.difficulty_levels` / `questions.difficulty` / `CustomSessionSpec` / 生成プロンプトなど複数箇所で混在し、どこで変換されるかも未定義だった。スキーマを作り始める前に一本化が必要。

## Decision

**6 段階 (`beginner / junior / mid / senior / staff / principal`) に統一**する。`intro / applied / edge_case` は廃止。

- `concepts.difficulty_levels`: その concept が意味を持つレベルの配列 (例: `[junior, mid, senior]`)
- `questions.difficulty`: 生成された問題のレベル (単一値)
- `CustomSessionSpec.DifficultySpec.absolute`: ユーザー指定レベル
- マスタリー昇格: 3 連続正解で同 concept の 1 段上へ、`difficulty_levels` の範囲内で
- Daily Drill の自動昇格上限は `mid`、`senior` 以上は明示指定時のみ

## Consequences

**Good:**
- スキーマ設計が 1 カラムで済む
- UI / プロンプト / DB 全層で同じ語彙を使える
- Custom Session で「senior レベルで」と言えばそのまま問題の `difficulty` にマップできる

**Bad:**
- 「同じ concept を浅い視点 vs 深い視点で問う」という元の `intro/applied/edge_case` の意図は、**難易度レベル単独では表現しきれない**。これは `thinking_style` (why / trade_off / edge_case 等) で別の軸として補う。

**後戻りコスト:**
- Seed YAML は `10-taxonomy-seed.md` 作成時点で 6 段階前提で書いているため、実装時のコストは低い
- 将来もう一段階増やしたくなったら列挙体を拡張すれば済む
