# ADR-0005: LLM プロバイダを Anthropic Claude → OpenAI に変更

- **Status**: Accepted
- **Date**: 2026-04-18
- **Supersedes**: `docs/03-ai-strategy.md` 全般

## Context

初期設計は Anthropic Claude API (Haiku 4.5 / Sonnet 4.6 / Opus 4.7) を採用。
「Claude 一本」と明言し、他プロバイダは `08.9` で明確に除外していた。

作者の利用環境と好みで **OpenAI** に寄せたい。ChatGPT Plus を既に契約していること、
Agent / Responses API などの新機能を触りたいことが主な理由。

## Decision

LLM は **OpenAI API 一本**で行く。Claude は使わない。

### モデル階層 (2026-04 時点)

| 用途 | モデル | 備考 |
|---|---|---|
| 問題生成 (MVP 全般) | `gpt-5` | コスパ・品質のバランス |
| 採点 (mcq/cloze 以外) | `gpt-5` | 精度重視 |
| 採点 (short) | `gpt-5-mini` | 安い、ルーブリック判定十分 |
| NL → CustomSessionSpec パース | `gpt-5-mini` | 構造化出力が速い |
| 誤概念抽出 | `gpt-5` | 精度重要 |
| 反論時の再採点 | `gpt-5` (別プロンプト) | MVP 必須 |
| 高難度 (Phase 2+) | `gpt-5` with `reasoning_effort: high` | 必要時のみ |

> モデル名は OpenAI の命名に追随して更新すること。実体は `src/lib/openai/models.ts` で 1 箇所に集約。

### 主要機能

- **Structured Outputs (`response_format: { type: 'json_schema' }`)** で JSON 生成を型安全に
- **Prompt Caching (自動)** — 1024 tokens 以上の共通 prefix は自動キャッシュ
- **Streaming** は MVP ではオフ。同期 JSON 応答で十分 (問題 1 問 < 10 秒)
- **Function Calling** は Phase 2+ (コード実行、対話採点)

### SDK

- `openai` npm パッケージ v5+
- `src/lib/openai/client.ts` にシングルトン集約

## Consequences

**Good:**
- ChatGPT Plus 利用者として UI と API の挙動感覚が揃う
- Structured Outputs が強力 (Anthropic も Structured Output あるが OpenAI の方が堅い)
- Prompt caching が自動で効く (手動の `cache_control` 設定不要)
- Agent SDK や Responses API への移行余地

**Bad:**
- コストは Claude とほぼ同等だが、モデルの世代感は変動する
- `06.5.2` / `08.9` で「Claude 一本」と明示していた箇所を全面書き換え
- ChatGPT 側と挙動の差が出る場合がある (プロンプト最適化はモデル依存)
- 将来 Claude に戻したくなったら SDK 層で差し替え可能な抽象化を入れておく

**後戻りコスト:**
- SDK 呼び出しを `src/lib/llm.ts` の薄いアダプタ層に閉じ込めれば、
  provider 差し替えは 1 ファイルの書き換えで済む
- プロンプトはほぼ共通 (system + user prompt)、JSON schema 定義は完全共通
