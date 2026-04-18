import { appUrl } from "@/lib/env";

/**
 * tRPC エンドポイント URL を返す。
 * - ブラウザ: 同一オリジンなので相対パスで十分 (NEXT_PUBLIC_ でない VERCEL_URL は client bundle に乗らないため fallback が効かない)
 * - サーバー (SSR / Server Component / Route Handler): 絶対 URL が必要なため appUrl ベースで組み立てる
 */
export function getTrpcUrl(): string {
  if (typeof window !== "undefined") {
    return "/api/trpc";
  }
  return `${appUrl}/api/trpc`;
}
