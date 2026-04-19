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
 *
 * FIFO 保証: caller 渡しの `enqueuedAt` 文字列は時計ずれや同一 ms のタイで順序が曖昧に
 * なりうるため (Codex Round 5 指摘 #2)、queue 層が採番する `sequence` (単調増加整数) を
 * 一次キーとして持ち、drain はこの順で取り出す。`sequence` は IndexedDB の
 * `autoIncrement: true` 機能で自動採番される。
 */

const DB_NAME = "tanren-offline";
const DB_VERSION = 2;
const STORE_SUBMITS = "pending-submits";
const IDX_CLIENT_ID = "by-clientId";

/** drain 時に「この閾値を超えた retryCount のエントリは削除」判定に使う上限
 *  (Codex Round 1 指摘 #3c: poison queue 防止)。指数バックオフは入れず単純に打ち切り。
 *  エラー本体は drainer 側で (本 PR ではコメント扱い、follow-up で) Sentry 送信する想定。 */
export const MAX_RETRY_COUNT = 5;

export type PendingSubmit = {
  /** クライアント側で生成する UUID。同一提出の重複 enqueue を防ぐ外部 key */
  clientId: string;
  /** enqueue 時点でログイン中だった userId。drain 時に現在の userId と一致しないエントリは
   *  破棄する (Codex Round 1 指摘 #3a: マルチユーザー端末での cross-user replay 防止)。 */
  userId: string;
  sessionId: string;
  questionId: string;
  userAnswer: string;
  reasonGiven?: string;
  elapsedMs?: number;
  /** 積まれた時刻 (ISO 8601)。表示用で drain 順には使わない */
  enqueuedAt: string;
  /** drain 失敗回数 (初期値 0)。MAX_RETRY_COUNT 超えで破棄 */
  retryCount?: number;
  /** submit 成功 + removeSubmit 失敗で cleanup 待ちになった時刻 (ISO 8601)。
   *  セットされていれば drainer は re-submit せず removeSubmit のみ再試行する。
   *  remount / effect 張り直しで消える in-memory Set だと race の永続化に足りない
   *  ので IndexedDB 行自体に印を付ける (Codex Round 11 指摘)。 */
  submittedAt?: string;
};

/** IndexedDB の内部 primary key (autoIncrement)。保存時だけ付与。 */
type StoredSubmit = PendingSubmit & { sequence?: number };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;
      // v1 → v2: 旧 store (keyPath=clientId) を捨てて autoIncrement primary key の
      // 新構造で作り直す。v1 は enqueue caller 未配線で queue は空のためデータロスなし。
      // それ以外 (v0 → v2 の新規 install) は素朴に create。
      // v2 以降の migration を入れる場合は elif を追加して既存データを保持すること
      // (Codex Round 14 指摘: 無条件 delete だと queue が毎回全消去される)。
      if (oldVersion < 2) {
        if (db.objectStoreNames.contains(STORE_SUBMITS)) {
          db.deleteObjectStore(STORE_SUBMITS);
        }
        const store = db.createObjectStore(STORE_SUBMITS, {
          keyPath: "sequence",
          autoIncrement: true,
        });
        // removeSubmit / incrementRetryOrRemove から clientId で引くためのセカンダリ index。
        store.createIndex(IDX_CLIENT_ID, "clientId", { unique: true });
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
    // sequence は autoIncrement で自動採番。同一 clientId は IDX_CLIENT_ID の UNIQUE
    // 制約で弾かれる (caller 側の二重 enqueue を防ぐ)。
    tx.objectStore(STORE_SUBMITS).add(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB add failed"));
  });
  db.close();
}

export async function listPendingSubmits(): Promise<PendingSubmit[]> {
  const db = await openDb();
  try {
    // primary key (sequence) 昇順に iterate。getAll() は primary key 順を保証するため
    // 呼び元でソート不要 (Codex Round 5 指摘 #2)。
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

async function deleteByClientId(store: IDBObjectStore, clientId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const idx = store.index(IDX_CLIENT_ID);
    const keyReq = idx.getKey(clientId);
    keyReq.onsuccess = () => {
      const pk = keyReq.result;
      if (pk === undefined) {
        resolve();
        return;
      }
      const delReq = store.delete(pk);
      delReq.onsuccess = () => resolve();
      delReq.onerror = () => reject(delReq.error ?? new Error("IndexedDB delete failed"));
    };
    keyReq.onerror = () => reject(keyReq.error ?? new Error("IndexedDB getKey failed"));
  });
}

export async function removeSubmit(clientId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SUBMITS, "readwrite");
      deleteByClientId(tx.objectStore(STORE_SUBMITS), clientId).then(
        () => {
          tx.oncomplete = () => resolve();
        },
        (err) => reject(err),
      );
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB tx failed"));
    });
  } finally {
    db.close();
  }
}

/** submit 成功後 removeSubmit が失敗したエントリに「cleanup 待ち」マークを付ける
 *  (Codex Round 11 指摘)。存在しない clientId はスキップ。 */
export async function markAsSubmitted(clientId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SUBMITS, "readwrite");
      const store = tx.objectStore(STORE_SUBMITS);
      const idx = store.index(IDX_CLIENT_ID);
      const getReq = idx.get(clientId);
      getReq.onsuccess = () => {
        const current = getReq.result as StoredSubmit | undefined;
        if (!current) {
          resolve();
          return;
        }
        store.put({ ...current, submittedAt: new Date().toISOString() });
      };
      getReq.onerror = () => reject(getReq.error ?? new Error("IndexedDB get failed"));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB tx failed"));
    });
  } finally {
    db.close();
  }
}

/** drain 失敗時に retryCount を +1 する。MAX_RETRY_COUNT を超える場合は削除して
 *  true を返す (caller 側でログ出力などに使う)。それ以外は false を返す。 */
export async function incrementRetryOrRemove(clientId: string): Promise<boolean> {
  const db = await openDb();
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE_SUBMITS, "readwrite");
      const store = tx.objectStore(STORE_SUBMITS);
      const idx = store.index(IDX_CLIENT_ID);
      const getReq = idx.get(clientId);
      getReq.onsuccess = () => {
        const current = getReq.result as StoredSubmit | undefined;
        if (!current || current.sequence === undefined) {
          resolve(false);
          return;
        }
        const nextCount = (current.retryCount ?? 0) + 1;
        if (nextCount > MAX_RETRY_COUNT) {
          store.delete(current.sequence);
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
