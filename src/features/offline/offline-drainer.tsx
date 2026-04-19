"use client";

import { useEffect } from "react";

import { incrementRetryOrRemove, listPendingSubmits, removeSubmit } from "@/lib/offline/queue";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { trpc } from "@/lib/trpc/react";

/** オフライン中に IndexedDB に積まれた session.submit を、オンライン復帰時に drain する
 *  (issue #40)。実装は client コンポーネントに閉じ、tRPC mutate を再実行するだけ。
 *
 *  server 側の (sessionId, questionId) UNIQUE 制約 + onConflictDoNothing で
 *  冪等に受け取られる (drill-screen の submit と同じ path)。採点結果 (grade) は drain 側では
 *  UI に反映しない (ユーザーは既にオフライン時に submit して別問題に進んでいる想定)。
 *
 *  本 PR 時点で enqueueSubmit を呼ぶ production caller は未配線 (drill-screen の submit
 *  onError からの wire-up は follow-up で対応、Codex Round 1 指摘 #2)。そのため現時点では
 *  queue は空のまま drainer は no-op。
 *
 *  mount 位置: `(app)/layout.tsx` で全認証ページに、HomeScreen 内部で `/` にも。/login など
 *  公開ルートでは mount されない (Codex Round 3/4 指摘)。
 *
 *  FIFO 保証: 1 件でも失敗した時点で同一 drain pass は break する (Codex Round 8 指摘 #1)。
 *  server 側の pendingQuestionId チェックは「次の未採点 questionId だけを受け付ける」ため、
 *  先頭 N が失敗したまま N+1 を送ると BAD_REQUEST になるだけでなく FIFO も崩れる。
 *
 *  同一 online セッション内の再試行: 失敗で break した後、単純な遅延で自己再起動する
 *  (Codex Round 8 指摘 #2)。一時的な 5xx / timeout で online のまま滞留するのを防止。
 *  retryCount 上限 (MAX_RETRY_COUNT) を queue 層で別途持っているので、再起動ループは
 *  自然に収束する。
 *
 *  マルチユーザー端末対策: drain 前に現在の userId と一致しないエントリは破棄する
 *  (enqueue 時の userId を PendingSubmit に保存、Codex Round 1 指摘 #3a)。
 */

/** 1 回の drain pass で submit 失敗を検知したあと、同じ online セッション内で再試行
 *  するまでの遅延 (ms)。サーバー側の一時障害 (5xx / timeout) の典型的な復旧時間を
 *  想定して 30 秒。 */
const DRAIN_RETRY_DELAY_MS = 30_000;

export function OfflineDrainer({ userId }: { userId: string }) {
  const online = useOnlineStatus();
  const submitMut = trpc.session.submit.useMutation();

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    let inFlight = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const drainOnce = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      let hadFailure = false;
      try {
        const pending = await listPendingSubmits();
        for (const p of pending) {
          if (cancelled) break;
          if (p.userId !== userId) {
            // 別ユーザーの queue は drain せず破棄 (cross-user replay 防止)
            await removeSubmit(p.clientId);
            continue;
          }
          try {
            await submitMut.mutateAsync({
              sessionId: p.sessionId,
              questionId: p.questionId,
              userAnswer: p.userAnswer,
              ...(p.reasonGiven !== undefined ? { reasonGiven: p.reasonGiven } : {}),
              ...(p.elapsedMs !== undefined ? { elapsedMs: p.elapsedMs } : {}),
            });
            await removeSubmit(p.clientId);
          } catch {
            // 失敗は retryCount を +1。上限超えで破棄 (poison queue 防止)
            await incrementRetryOrRemove(p.clientId).catch(() => {});
            hadFailure = true;
            break;
          }
        }
      } catch {
        // IndexedDB 取得自体に失敗したケース: 次回 online で再試行
      } finally {
        inFlight = false;
      }
      if (hadFailure && !cancelled) {
        retryTimer = setTimeout(drainOnce, DRAIN_RETRY_DELAY_MS);
      }
    };

    void drainOnce();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // submitMut は useMutation の返す object が内部 state 変更で別参照になりうるため、
    // deps に含めると effect が意図せず再発火する (Codex Round 1 指摘 #1)。
    // 参照は closure で固定で問題ない (mutateAsync 自体は破壊的な変化なし)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, userId]);

  return null;
}
