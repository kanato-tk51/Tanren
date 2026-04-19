import "server-only";

import webpush from "web-push";

/** Web Push サービス (issue #37)。
 *  VAPID 鍵未設定なら null (送信 no-op)。本番では生成した VAPID 鍵を Vercel env に登録する。
 *  `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY` はクライアントが subscribe() で使う。
 */

let initialized = false;

function configure(): boolean {
  if (initialized) return true;
  const pub = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const priv = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_SUBJECT ?? "mailto:noreply@tanren.vercel.app";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  initialized = true;
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

/** 1 件の subscription に対して push を送信。410/404 は「subscription が失効」なので
 *  呼び出し側で DB から delete する判断材料として statusCode を含む Error を throw する。 */
export async function sendPushNotification(args: {
  endpoint: string;
  p256dh: string;
  auth: string;
  payload: PushPayload;
}): Promise<{ ok: true } | { ok: false; statusCode: number; message: string }> {
  if (!configure()) {
    return { ok: false, statusCode: 501, message: "VAPID keys not configured" };
  }
  try {
    await webpush.sendNotification(
      {
        endpoint: args.endpoint,
        keys: { p256dh: args.p256dh, auth: args.auth },
      },
      JSON.stringify(args.payload),
    );
    return { ok: true };
  } catch (err) {
    const e = err as { statusCode?: number; body?: string; message?: string };
    return {
      ok: false,
      statusCode: e.statusCode ?? 500,
      message: e.body ?? e.message ?? "unknown push error",
    };
  }
}

/** クライアント側 subscribe() 用の public key (base64url) */
export function webPushPublicKey(): string | null {
  return process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY ?? null;
}
