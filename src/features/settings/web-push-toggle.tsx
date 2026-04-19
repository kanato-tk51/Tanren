"use client";

import { Bell } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/react";

type ServerSubscribeInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string;
};

/** base64url 文字列を ArrayBuffer に変換 (PushManager.subscribe の applicationServerKey 用)。
 *  DOM 型定義の都合で Uint8Array<ArrayBufferLike> ではなく純粋 ArrayBuffer を返す。 */
function urlBase64ToArrayBuffer(base64Url: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buffer;
}

type Status = "unsupported" | "denied" | "unsubscribed" | "subscribed";

export function WebPushToggle() {
  const publicKeyQuery = trpc.push.getPublicKey.useQuery(undefined, {
    retry: false,
  });
  const settingsQuery = trpc.settings.get.useQuery();
  const utils = trpc.useUtils();
  const subscribeMut = trpc.push.subscribe.useMutation();
  const unsubscribeMut = trpc.push.unsubscribe.useMutation();
  const setEnabledMut = trpc.push.setEnabled.useMutation();

  const [status, setStatus] = useState<Status>("unsubscribed");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 初回: 現在の permission / subscription 状態を把握。
  // UI の ON/OFF は「この端末で subscription あり」AND「サーバー側 webPushEnabled=true」の AND
  // (Codex Round 2 指摘 A: 責務分離後の UI 整合)。
  const webPushEnabled = settingsQuery.data?.webPushEnabled ?? false;
  useEffect(() => {
    void (async () => {
      if (typeof window === "undefined") return;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      const subscribedHere = Boolean(sub);
      setStatus(subscribedHere && webPushEnabled ? "subscribed" : "unsubscribed");
    })();
  }, [webPushEnabled]);

  const onSubscribe = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      if (publicKeyQuery.isError || !publicKeyQuery.data) {
        throw new Error("VAPID public key がサーバー側で未設定です");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "unsubscribed");
        return;
      }
      // RegisterServiceWorker (src/features/pwa/register-sw.tsx) は production のみ
      // register する。dev で Web Push トグルを押すと serviceWorker.ready が永遠に解決せず
      // ハングするため、未登録ならここで明示的に register する (Codex Round 3 指摘 #2)。
      const existing = await navigator.serviceWorker.getRegistration();
      if (!existing) {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(publicKeyQuery.data.publicKey),
      });
      const json = sub.toJSON();
      const p256dh = json.keys?.p256dh;
      const auth = json.keys?.auth;
      if (!json.endpoint || !p256dh || !auth) {
        // subscription 形式が不正: push 側を unsubscribe して orphan を残さない
        await sub.unsubscribe().catch(() => undefined);
        throw new Error("subscription の形式が不正です");
      }
      const serverInput: ServerSubscribeInput = {
        endpoint: json.endpoint,
        p256dh,
        auth,
        userAgent: navigator.userAgent,
      };
      try {
        await subscribeMut.mutateAsync(serverInput);
      } catch (e) {
        // server 側保存失敗で pushManager.subscribe() だけ生き残る orphan を防止
        // (Codex Round 1 指摘 #2)
        await sub.unsubscribe().catch(() => undefined);
        throw e;
      }
      // 購読と設定フラグの責務分離 (Codex Round 1 指摘 #3)。購読成功したら明示的に ON にする。
      await setEnabledMut.mutateAsync({ enabled: true });
      await utils.settings.get.invalidate();
      setStatus("subscribed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "購読に失敗しました");
    } finally {
      setBusy(false);
    }
  }, [publicKeyQuery.isError, publicKeyQuery.data, subscribeMut, setEnabledMut, utils]);

  const onUnsubscribe = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await unsubscribeMut.mutateAsync({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      // onSubscribe と対称に、機能全体の送信 gate も OFF にする (Codex Round 2 指摘 B)。
      // push.unsubscribe は最後の 1 件削除時のみ web_push_enabled=false にするので、
      // 複数デバイスで購読していても、このデバイスで OFF を押したら配信 gate も切る意図を尊重。
      await setEnabledMut.mutateAsync({ enabled: false });
      await utils.settings.get.invalidate();
      setStatus("unsubscribed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "解除に失敗しました");
    } finally {
      setBusy(false);
    }
  }, [unsubscribeMut, setEnabledMut, utils]);

  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 font-medium">
          <Bell className="h-4 w-4" /> Web Push
        </div>
        <div className="text-muted-foreground text-xs">
          Daily reminder をブラウザ通知で受け取る (iOS は A2HS 後のみ動作、docs/07 §7.5.5)
        </div>
        {status === "unsupported" && (
          <div className="text-destructive mt-1 text-xs">このブラウザは Web Push 非対応</div>
        )}
        {status === "denied" && (
          <div className="text-destructive mt-1 text-xs">
            通知が拒否されています。ブラウザ設定から許可してください
          </div>
        )}
        {error && <div className="text-destructive mt-1 text-xs">{error}</div>}
      </div>
      <Button
        variant={status === "subscribed" ? "default" : "outline"}
        size="sm"
        disabled={busy || status === "unsupported" || status === "denied"}
        onClick={status === "subscribed" ? onUnsubscribe : onSubscribe}
      >
        {status === "subscribed" ? "ON" : "OFF"}
      </Button>
    </div>
  );
}
