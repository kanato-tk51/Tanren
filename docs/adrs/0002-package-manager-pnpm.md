# ADR-0002: パッケージマネージャに pnpm を採用

- **Status**: Accepted
- **Date**: 2026-04-18

## Context

Next.js プロジェクトのパッケージマネージャを決める必要がある。候補は npm / yarn (classic) / yarn (berry) / pnpm / bun。

個人開発なので以下を重視する:
- 依存の再現性 (将来また触ったときに同じ環境が作れる)
- ディスク消費 (複数プロジェクトを行き来するので)
- Vercel のサポート状況
- Claude Code / Codex 等 AI アシストの実績

Bun は `docs/06-architecture.md` 6.5.1 の議論で runtime として既に却下済み。

## Decision

**pnpm** を採用する。

- Node.js バージョンは `.nvmrc` で 22 LTS 固定
- `package.json` に `"packageManager": "pnpm@10.x"` を明示

## Consequences

**Good:**
- Content-addressed store で node_modules のディスク消費が激減
- Workspace 対応でモノレポ化しても困らない
- Next.js / Turbo / Vercel でサポート済み、実績豊富
- `pnpm-lock.yaml` の diff が npm より読みやすい

**Bad:**
- 一部の古いパッケージ (Phantom dependency に頼っているもの) で不具合が出ることがある
  → `public-hoist-pattern` で局所対応
- `npx` に相当するコマンドは `pnpm dlx`、手癖と違う

**後戻りコスト:**
- `package.json` / lockfile の差し替えだけで npm / yarn に戻せる。低い。
