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

/** OAuth callback が /login?error=... にリダイレクトしてくるケースを想定した短い訳語。
 *  コード内部値は src/app/api/auth/github/callback/route.ts の errorRedirect に合わせる。 */
const ERROR_MESSAGES: Record<string, string> = {
  invalid_request: "不正なリクエストです。もう一度ログインしてください。",
  state_expired: "ログイン状態が期限切れになりました。もう一度お試しください。",
  state_mismatch: "セキュリティ検証に失敗しました。別タブでログインしていた場合は閉じてください。",
  server_misconfigured: "サーバー側の環境変数が未設定です (管理者に連絡)。",
  token_exchange_failed: "GitHub とのトークン交換に失敗しました。",
  user_fetch_failed: "GitHub ユーザー情報の取得に失敗しました。",
  forbidden: "この GitHub アカウントはこのアプリにアクセスできません。",
  not_bootstrapped: "ユーザーの初期設定が済んでいません (pnpm auth:bootstrap を実行)。",
};

/** GitHub OAuth 認証 UI (ADR-0006)。
 *  `/api/auth/github/login` にジャンプするだけ。セッション管理は callback 側。 */
export function LoginForm() {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");
  const errorMessage = errorCode ? (ERROR_MESSAGES[errorCode] ?? `Error: ${errorCode}`) : null;

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
