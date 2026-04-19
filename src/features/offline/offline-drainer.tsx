"use client";

import { TRPCClientError } from "@trpc/client";
import { useEffect } from "react";

import {
  incrementRetryOrRemove,
  listPendingSubmits,
  markAsSubmitted,
  removeSubmit,
} from "@/lib/offline/queue";
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
 *  再試行: 失敗で break した後、単純な遅延で自己再起動する (Codex Round 8 指摘 #2)。
 *  一時的な 5xx / timeout で online のまま滞留するのを防止。listPendingSubmits 等の
 *  IndexedDB 側失敗も同じ経路で再スケジュールする (Codex Round 9 指摘 #2)。
 *
 *  UNAUTHORIZED (セッション切れ): retryCount は消費せずキューを保持する
 *  (Codex Round 9 指摘 #1)。再ログイン後の drainer remount で再度 drain される。
 *  retry 連鎖に含めると再ログインなしでいずれキューから削除されて解答が失われる。
 *
 *  マルチユーザー端末対策: drain 前に現在の userId と一致しないエントリは破棄する
 *  (enqueue 時の userId を PendingSubmit に保存、Codex Round 1 指摘 #3a)。
 */

const DRAIN_RETRY_DELAY_MS = 30_000;

function isUnauthorizedError(err: unknown): boolean {
  if (err instanceof TRPCClientError) {
    // tRPC v11 では data.code に string の SPECERROR が入る (procedure の TRPCError.code)
    const code = (err.data as { code?: string } | undefined)?.code;
    if (code === "UNAUTHORIZED") return true;
  }
  return false;
}

export function OfflineDrainer({ userId }: { userId: string }) {
  const online = useOnlineStatus();
  const submitMut = trpc.session.submit.useMutation();

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    let inFlight = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRetry = () => {
      if (cancelled || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void drainOnce();
      }, DRAIN_RETRY_DELAY_MS);
    };

    const drainOnce = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      // outer catch (IndexedDB 失敗) でも再試行したいので hadFailure を try/finally の外で管理。
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
          if (p.submittedAt !== undefined) {
            // 前 pass で submit は成功しているので、cleanup だけ再試行 (再 submit 禁止)。
            // submittedAt は IndexedDB 側の永続フィールドなので remount / reload 後も
            // 残る (Codex Round 11 指摘: in-memory Set だと mount 跨ぎで消失する)。
            try {
              await removeSubmit(p.clientId);
            } catch {
              hadFailure = true;
              break;
            }
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
          } catch (err) {
            if (isUnauthorizedError(err)) {
              // 再ログイン後に drainer remount で再 drain されるので retryCount を消費しない。
              // 自己再試行もスキップ (auth が戻るまで 30 秒おきに失敗し続けても意味なし)。
              break;
            }
            await incrementRetryOrRemove(p.clientId).catch(() => {});
            hadFailure = true;
            break;
          }
          // submit 成功。removeSubmit 前に submittedAt を永続化しておくことで、
          // 直後の removeSubmit が失敗しても次 pass / remount 後でも re-submit を回避できる。
          try {
            await markAsSubmitted(p.clientId);
          } catch {
            // 印を付けられなかった場合は安全側で break。次 pass で submit が再走する
            // と pendingQuestionId 不一致で BAD_REQUEST になるのを避けるため、
            // ここでは incrementRetry せずに break (UNAUTHORIZED と同じ扱い)。
            hadFailure = true;
            break;
          }
          try {
            await removeSubmit(p.clientId);
          } catch {
            // submit は成功済み & submittedAt 印あり。次 pass で remove だけ再試行する。
            hadFailure = true;
            break;
          }
        }
      } catch {
        // listPendingSubmits 等の IndexedDB 失敗。次回 retry で再試行。
        hadFailure = true;
      } finally {
        inFlight = false;
      }
      if (hadFailure) {
        scheduleRetry();
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
