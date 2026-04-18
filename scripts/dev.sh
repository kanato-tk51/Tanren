#!/usr/bin/env bash
# vercel dev を起動する thin wrapper。
# Vercel CLI 51.x が package.json の "dev" script に "vercel dev" を見つけると
# 自己再帰防止で即エラーに落とすため、スクリプト経由で起動して回避する。

set -euo pipefail

exec vercel dev "$@"
