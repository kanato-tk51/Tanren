"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Passkey 認証 UI の最小セット。
 * - Passkey 有効環境: `startAuthentication` を叩いて cookie を発行
 * - Passkey 無効環境 (Preview / 作者 dev): `/api/auth/dev-login` でユーザー 1 名自動ログイン
 */
export function LoginForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePasskey() {
    setError(null);
    setLoading(true);
    try {
      const optionsRes = await fetch("/api/auth/authenticate/options", { method: "POST" });
      if (!optionsRes.ok) throw new Error(await optionsRes.text());
      const { options, challengeId } = (await optionsRes.json()) as {
        options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
        challengeId: string;
      };
      const response = await startAuthentication({ optionsJSON: options });
      const verifyRes = await fetch("/api/auth/authenticate/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId, response }),
      });
      if (!verifyRes.ok) throw new Error(await verifyRes.text());
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Passkey login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleDevLogin() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/dev-login", { method: "POST" });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || "dev login refused");
      }
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "dev login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>ログイン</CardTitle>
        <CardDescription>Passkey でサインインします。</CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground space-y-2 text-sm">
        {error && <div className="text-destructive">{error}</div>}
      </CardContent>
      <CardFooter className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={handlePasskey} disabled={loading}>
          {loading ? "通信中…" : "Passkey でログイン"}
        </Button>
        <Button variant="outline" onClick={handleDevLogin} disabled={loading}>
          Dev ショートカット
        </Button>
      </CardFooter>
    </Card>
  );
}
