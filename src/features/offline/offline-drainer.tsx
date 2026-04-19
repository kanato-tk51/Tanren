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
 *
 *  クロスタブ排他: drain ループ全体を `navigator.locks.request(DRAIN_LOCK_NAME)` で包む
 *  (Codex Round 13 指摘 #1)。同一 origin で複数タブ / iframe が mount されたとき、
 *  各 drainer が同じ entry を同時 submit して BAD_REQUEST → retryCount 消費になるのを防ぐ。
 *
 *  submittedAt 永続化の fallback: IndexedDB へ印を付けられないときは localStorage にも
 *  clientId を積む (Codex Round 13 指摘 #2)。localStorage は IndexedDB とは別 backend
 *  なので両方同時に壊れる可能性は小さい。drain 先頭で両方を読んで merge する。
 */

const DRAIN_RETRY_DELAY_MS = 30_000;
const DRAIN_LOCK_NAME = "tanren-offline-drainer";

/** submit 成功直後の markAsSubmitted 永続化のインライン retry 回数 + backoff。 */
const MARK_PERSIST_ATTEMPTS = 5;
const MARK_PERSIST_DELAY_MS = 200;

/** localStorage fallback key。値は JSON array of clientId。 */
const LS_SUBMITTED_KEY = "tanren-offline-submitted-fallback";

function loadLocalSubmittedSet(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(LS_SUBMITTED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? new Set(arr.filter((v): v is string => typeof v === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function addLocalSubmitted(clientId: string): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    const set = loadLocalSubmittedSet();
    if (set.has(clientId)) return true;
    set.add(clientId);
    localStorage.setItem(LS_SUBMITTED_KEY, JSON.stringify([...set]));
    return true;
  } catch {
    return false;
  }
}

function removeLocalSubmitted(clientId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const set = loadLocalSubmittedSet();
    if (!set.has(clientId)) return;
    set.delete(clientId);
    localStorage.setItem(LS_SUBMITTED_KEY, JSON.stringify([...set]));
  } catch {
    // 読み書きともに壊れている状態。どうしようもないので諦める。
  }
}

async function persistMarkAsSubmitted(clientId: string): Promise<boolean> {
  for (let i = 0; i < MARK_PERSIST_ATTEMPTS; i++) {
    try {
      await markAsSubmitted(clientId);
      return true;
    } catch {
      if (i < MARK_PERSIST_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, MARK_PERSIST_DELAY_MS * (i + 1)));
      }
    }
  }
  // IndexedDB 書き込みが完全に不通 → localStorage に退避。drain 先頭で merge される。
  return addLocalSubmitted(clientId);
}

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

    const drainBody = async (): Promise<boolean> => {
      // return: hadFailure
      let hadFailure = false;
      try {
        const pending = await listPendingSubmits();
        const localSubmitted = loadLocalSubmittedSet();
        for (const p of pending) {
          if (cancelled) break;
          if (p.userId !== userId) {
            await removeSubmit(p.clientId);
            continue;
          }
          const alreadySubmitted = p.submittedAt !== undefined || localSubmitted.has(p.clientId);
          if (alreadySubmitted) {
            try {
              await removeSubmit(p.clientId);
              // IndexedDB 側の remove が成功したので localStorage fallback も掃除
              removeLocalSubmitted(p.clientId);
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
              break;
            }
            await incrementRetryOrRemove(p.clientId).catch(() => {});
            hadFailure = true;
            break;
          }
          const marked = await persistMarkAsSubmitted(p.clientId);
          if (!marked) {
            // IndexedDB + localStorage の両方で印を付けられなかった = ブラウザ storage
            // レイヤが壊滅的。安全側で break、retryCount は消費しない。
            hadFailure = true;
            break;
          }
          try {
            await removeSubmit(p.clientId);
            removeLocalSubmitted(p.clientId);
          } catch {
            hadFailure = true;
            break;
          }
        }
      } catch {
        hadFailure = true;
      }
      return hadFailure;
    };

    const drainOnce = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      let hadFailure = false;
      try {
        if (typeof navigator !== "undefined" && "locks" in navigator) {
          // Web Locks API でタブ / iframe 間の排他。`exclusive` (default) なので同一
          // origin で同時に保持できるのは 1 つだけ。ロック取得までの待機は他タブの
          // drain 完了まで (短時間)。
          await navigator.locks.request(DRAIN_LOCK_NAME, async () => {
            if (cancelled) return;
            hadFailure = await drainBody();
          });
        } else {
          // 古いブラウザ fallback: ロックなしで実行。複数タブでの race は発生しうる。
          hadFailure = await drainBody();
        }
      } finally {
        inFlight = false;
      }
      if (hadFailure && !cancelled) {
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
