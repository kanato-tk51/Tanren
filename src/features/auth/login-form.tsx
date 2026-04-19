"use client";

import { LogIn } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { OAuthErrorCode } from "@/server/auth/errors";

/** OAuth callback が /login?error=... にリダイレクトしてくるケースの UI 向け短い日本語訳。
 *  コード内部値は `OAuthErrorCode` 列挙 (src/server/auth/errors.ts) と一致させる。
 *  コード表を route と UI で 1 つに集約するため、キー型を `OAuthErrorCode` に縛る
 *  (Codex PR#86 Round 5 指摘 #2)。 */
const ERROR_MESSAGES: Record<OAuthErrorCode, string> = {
  invalid_request: "不正なリクエストです。もう一度ログインしてください。",
  state_expired: "ログイン状態が期限切れになりました。もう一度お試しください。",
  state_mismatch: "セキュリティ検証に失敗しました。別タブでログインしていた場合は閉じてください。",
  server_misconfigured: "サーバー側の環境変数が未設定です (管理者に連絡)。",
  token_exchange_failed: "GitHub とのトークン交換に失敗しました。",
  user_fetch_failed: "GitHub ユーザー情報の取得に失敗しました。",
  forbidden: "この GitHub アカウントはこのアプリにアクセスできません。",
  not_bootstrapped:
    "ユーザーの初期設定が済んでいません (pnpm auth:bootstrap <github_user_id> を実行)。",
};

/** GitHub OAuth 認証 UI (ADR-0006)。
 *  `/api/auth/github/login` にジャンプするだけ。セッション管理は callback 側。 */
function isKnownErrorCode(code: string): code is OAuthErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code);
}

export function LoginForm() {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");
  const errorMessage = errorCode
    ? isKnownErrorCode(errorCode)
      ? ERROR_MESSAGES[errorCode]
      : `Error: ${errorCode}`
    : null;

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>ログイン</CardTitle>
        <CardDescription>GitHub アカウントでサインインします。</CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground text-sm">
        {errorMessage && <div className="text-destructive">{errorMessage}</div>}
      </CardContent>
      <CardFooter>
        <Button asChild>
          <a href="/api/auth/github/login">
            <LogIn className="mr-2 h-4 w-4" />
            GitHub でログイン
          </a>
        </Button>
      </CardFooter>
    </Card>
  );
}
