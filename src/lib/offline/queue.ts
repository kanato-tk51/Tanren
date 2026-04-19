"use client";

/**
 * オフライン中の保留操作を IndexedDB に積むキュー (issue #40)。
 *
 * 設計方針:
 *   - MVP は「session.submit の提出内容」だけを保留対象にする (最も rollback コストが
 *     大きく、オフラインでも即時 UI フィードバックを出したい操作)。他のミューテーション
 *     (rebut / dialogue / template 保存 等) は別 PR でスコープを広げる。
 *   - 暗号化はしない (credentialed 情報を含むため attacker 物理アクセス時に漏れる)。
 *     端末が信頼できる前提は PWA 一般の許容線と同じ。ブラウザ / アプリを消せば消える。
 *   - 復帰時の送信失敗 (既に採点済みなど) は userAnswer/questionId/sessionId の
 *     (sessionId, questionId) UNIQUE 制約で server 側が冪等に onConflictDoNothing。
 *
 * 注意: enqueueSubmit の production caller (drill-screen の submit onError からの配線) は
 * 本 PR のスコープ外。本 PR ではインフラ (queue + drainer + banner) だけを入れ、
 * 実配線は follow-up で追加する (Codex Round 1 指摘 #2、別 issue で継続)。
 */

const DB_NAME = "tanren-offline";
const DB_VERSION = 1;
const STORE_SUBMITS = "pending-submits";

/** drain 時に「この閾値を超えた retryCount のエントリは削除」判定に使う上限
 *  (Codex Round 1 指摘 #3c: poison queue 防止)。指数バックオフは入れず単純に打ち切り。
 *  エラー本体は drainer 側で (本 PR ではコメント扱い、follow-up で) Sentry 送信する想定。 */
export const MAX_RETRY_COUNT = 5;

export type PendingSubmit = {
  /** クライアント側で生成する UUID。drain 時のキーにする */
  clientId: string;
  /** enqueue 時点でログイン中だった userId。drain 時に現在の userId と一致しないエントリは
   *  破棄する (Codex Round 1 指摘 #3a: マルチユーザー端末での cross-user replay 防止)。 */
  userId: string;
  sessionId: string;
  questionId: string;
  userAnswer: string;
  reasonGiven?: string;
  elapsedMs?: number;
  /** 積まれた時刻 (ISO 8601) */
  enqueuedAt: string;
  /** drain 失敗回数 (初期値 0)。MAX_RETRY_COUNT 超えで破棄 */
  retryCount?: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SUBMITS)) {
        db.createObjectStore(STORE_SUBMITS, { keyPath: "clientId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export async function enqueueSubmit(item: PendingSubmit): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_SUBMITS, "readwrite");
    tx.objectStore(STORE_SUBMITS).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB put failed"));
  });
  db.close();
}

export async function listPendingSubmits(): Promise<PendingSubmit[]> {
  const db = await openDb();
  try {
    return await new Promise<PendingSubmit[]>((resolve, reject) => {
      const tx = db.transaction(STORE_SUBMITS, "readonly");
      const req = tx.objectStore(STORE_SUBMITS).getAll();
      req.onsuccess = () => resolve(req.result as PendingSubmit[]);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB getAll failed"));
    });
  } finally {
    db.close();
  }
}

export async function removeSubmit(clientId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_SUBMITS, "readwrite");
    tx.objectStore(STORE_SUBMITS).delete(clientId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
  });
  db.close();
}

/** drain 失敗時に retryCount を +1 する。MAX_RETRY_COUNT を超える場合は削除して
 *  true を返す (caller 側でログ出力などに使う)。それ以外は false を返す。 */
export async function incrementRetryOrRemove(clientId: string): Promise<boolean> {
  const db = await openDb();
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE_SUBMITS, "readwrite");
      const store = tx.objectStore(STORE_SUBMITS);
      const getReq = store.get(clientId);
      getReq.onsuccess = () => {
        const current = getReq.result as PendingSubmit | undefined;
        if (!current) {
          resolve(false);
          return;
        }
        const nextCount = (current.retryCount ?? 0) + 1;
        if (nextCount > MAX_RETRY_COUNT) {
          store.delete(clientId);
          tx.oncomplete = () => resolve(true);
        } else {
          store.put({ ...current, retryCount: nextCount });
          tx.oncomplete = () => resolve(false);
        }
      };
      getReq.onerror = () => reject(getReq.error ?? new Error("IndexedDB get failed"));
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB tx failed"));
    });
  } finally {
    db.close();
  }
}

/** queue の全件を丸ごと置き換える (他ユーザーでログインしたときの purge 用) */
export async function clearPendingSubmits(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_SUBMITS, "readwrite");
    tx.objectStore(STORE_SUBMITS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB clear failed"));
  });
  db.close();
}
