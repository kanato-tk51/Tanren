"use client";

import { useEffect, useRef } from "react";

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
 *  userId は server (layout.tsx → AppShell) が解決したものを props で受ける。これは
 *  trpc.auth.me.useQuery を client で再度呼ぶと未ログインページで共有 React Query cache に
 *  { authenticated: false } が seed されて post-login 画面の initialData が無効化される
 *  回帰を避けるため (Codex Round 3 指摘)。AppShell 側が initialUserId=null なら mount
 *  自体をスキップするので、ここに来る時点で userId は必ず存在する。
 *
 *  マルチユーザー端末対策: drain 前に現在の userId と一致しないエントリは破棄する
 *  (enqueue 時の userId を PendingSubmit に保存、Codex Round 1 指摘 #3a)。
 *  永続失敗対策: drain 失敗時 retryCount を +1、MAX_RETRY_COUNT 超えで破棄 (同 #3c)。
 */
export function OfflineDrainer({ userId }: { userId: string }) {
  const online = useOnlineStatus();
  const draining = useRef(false);
  const submitMut = trpc.session.submit.useMutation();

  useEffect(() => {
    if (!online || draining.current) return;
    draining.current = true;
    (async () => {
      try {
        const pending = await listPendingSubmits();
        for (const p of pending) {
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
          }
        }
      } catch {
        // IndexedDB 取得自体に失敗したケース: 次の online で再試行
      } finally {
        draining.current = false;
      }
    })();
    // submitMut は useMutation の返す object が内部 state 変更で別参照になりうるため、
    // deps に含めると effect が意図せず再発火する (Codex Round 1 指摘 #1)。
    // 参照は closure で固定で問題ない (mutateAsync 自体は破壊的な変化なし)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, userId]);

  return null;
}
