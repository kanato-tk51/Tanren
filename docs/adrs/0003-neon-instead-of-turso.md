# ADR-0003: DB を Turso (libSQL) → Neon (PostgreSQL) に変更

- **Status**: Accepted
- **Date**: 2026-04-18
- **Supersedes**: `docs/06-architecture.md` の初期 DB 選定

## Context

初期設計では Turso (libSQL) を採用していた。理由は:
- エッジ分散 + 無料枠
- FTS5 の全文検索
- SQLite 互換の軽快さ

その後、作者の好みと運用実績から **Neon (serverless PostgreSQL)** に寄せたい旨の意思決定。
Vercel との統合も Neon は公式で、サーバーレス関数からの接続が最適化されている。

## Decision

DB は **Neon (PostgreSQL 16+)** を採用する。

- 接続ドライバ: `@neondatabase/serverless` (HTTP fetch 経由、Edge runtime 互換)
- ORM: **Drizzle ORM** (pg dialect) で継続
- マイグレーション: `drizzle-kit` (`dialect: 'postgresql'`)
- 全文検索: `tsvector` + GIN index (+ `pg_trgm` 日本語対応)
- ブランチ機能: Neon の Branch で preview 環境ごとに隔離

## Consequences

**Good:**
- Vercel + Neon の公式連携で env 設定が楽
- 真の RDB 機能 (ウィンドウ関数 / CTE / JSON / tsvector) が使える
- 水平スケール・コネクションプール・バックアップを Neon 側が面倒見る
- Drizzle は SQLite から pg へ移行が機械的

**Bad:**
- FTS5 より tsvector の方が日本語トークナイズに手間 (`pg_trgm` or `pgroonga` 等の工夫)
- SQLite のインメモリ DB でのユニットテストは不可 → テスト用に Neon branch を切るか、Docker Postgres を使う
- 1 行しか入らない個人用途には若干オーバースペック (無料枠で十分だが)

**後戻りコスト:**
- スキーマ書き換えは unify 済みの `06-architecture.md` 一箇所で完結
- 実装が進んでからの戻りはコスト高 → 開始前に切り替える今が最適タイミング
