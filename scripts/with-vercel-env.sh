#!/usr/bin/env bash
# Vercel から Development 環境の env 変数を一時ファイルに pull し、
# export してから任意のコマンドを実行する。終了時にファイルは必ず削除。
#
# 使い方:
#   ./scripts/with-vercel-env.sh pnpm db:migrate
#   ./scripts/with-vercel-env.sh pnpm tsx src/some-script.ts
#
# 環境切替:
#   WITH_VERCEL_ENV_TARGET=preview ./scripts/with-vercel-env.sh ...
#   WITH_VERCEL_ENV_TARGET=production ./scripts/with-vercel-env.sh ...
#
# 前提:
#   - pnpm dlx vercel login 済み
#   - このディレクトリで vercel link 済み (.vercel/project.json あり)

set -euo pipefail

TARGET="${WITH_VERCEL_ENV_TARGET:-development}"

if [ ! -f .vercel/project.json ]; then
  echo "❌ .vercel/project.json がありません。先に 'pnpm dlx vercel link' を実行してください。" >&2
  exit 1
fi

if [ $# -eq 0 ]; then
  echo "❌ 実行するコマンドを引数に渡してください。例: $0 pnpm db:migrate" >&2
  exit 1
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# --yes で対話を抑止、stderr はログ用に残す
pnpm dlx vercel@latest env pull "$TMP" --environment="$TARGET" --yes >/dev/null

# 空行とコメントを除いて export
# shellcheck disable=SC2046
set -a
# shellcheck source=/dev/null
source "$TMP"
set +a

exec "$@"
