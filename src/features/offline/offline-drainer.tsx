"use client";

import { useEffect, useRef } from "react";

import { listPendingSubmits, removeSubmit } from "@/lib/offline/queue";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { trpc } from "@/lib/trpc/react";

/** オフライン中に IndexedDB に積まれた session.submit を、オンライン復帰時に drain する
 *  (issue #40)。実装は client コンポーネントに閉じ、tRPC mutate を再実行するだけ。
 *
 *  server 側の (sessionId, questionId) UNIQUE 制約 + onConflictDoNothing で
 *  冪等に受け取られる (drill-screen の submit と同じ path)。採点結果 (grade) は drain 側では
 *  UI に反映しない (ユーザーは既にオフライン時に submit して別問題に進んでいる想定)。
 */
export function OfflineDrainer() {
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
            // 失敗は残しておき、次の online イベントで再試行
          }
        }
      } catch {
        // IndexedDB 取得自体に失敗したケース: 次の online で再試行
      } finally {
        draining.current = false;
      }
    })();
  }, [online, submitMut]);

  return null;
}
