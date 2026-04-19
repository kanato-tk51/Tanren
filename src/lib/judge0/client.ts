import "server-only";

import { isJudge0Language, languageId, type Judge0Language } from "./languages";

/** Judge0 実行結果 (MVP: stdout / stderr / status / 実行時間のみ返す) */
export type Judge0Result = {
  stdout: string;
  stderr: string;
  /** Judge0 の submission.status.description (例: "Accepted", "Runtime Error (NZEC)") */
  status: string;
  /** 実行時間 (秒、Judge0 の "time" 文字列をパースして数値化) */
  timeSec: number | null;
  /** 使用メモリ (KB、Judge0 の "memory") */
  memoryKb: number | null;
  /** Judge0 submission token (デバッグ用) */
  token: string;
};

/** Judge0 実行がサーバー側で disabled な場合のエラー (env 未設定など) */
export class Judge0DisabledError extends Error {
  constructor() {
    super("Judge0 コード実行は無効化されています (JUDGE0_API_KEY / JUDGE0_URL が未設定)");
    this.name = "Judge0DisabledError";
  }
}

/** Judge0 側の実行失敗や rate limit */
export class Judge0RequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "Judge0RequestError";
  }
}

/** ソース / 標準入力の最大サイズ (10KB)。超過時は BAD_REQUEST 相当で reject する */
export const JUDGE0_MAX_SOURCE_BYTES = 10 * 1024;

/** Judge0 側の壁時計上限 (秒)。無料 tier でも通る値、過度な 10s 以上は RapidAPI で drop される */
export const JUDGE0_WALL_TIME_LIMIT_SEC = 5;

/** fetch 全体の client-side timeout (ms)。wall_time_limit (5s) に加えて、キュー待ち +
 *  ネットワーク遅延を見込んでも Vercel Functions の 10s デフォルト制限の手前で打ち切る
 *  (Codex Round 1 指摘 #1)。 */
export const JUDGE0_FETCH_TIMEOUT_MS = 8_000;

function toBase64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

function fromBase64(s: string | null | undefined): string {
  if (!s) return "";
  return Buffer.from(s, "base64").toString("utf-8");
}

/** Judge0 へ 1 件の submission を投げて結果を返す (wait=true で同期応答)。
 *  - base64_encoded=true で source / stdin を UTF-8 安全にエンコード
 *  - wait=true にすると submission 作成 + 実行完了をブロッキング待ちできる (MVP で十分、polling 不要)
 *  - 環境変数未設定は Judge0DisabledError で早期 throw (呼び出し側は catch して UI でスキップする)
 */
export async function executeCode(args: {
  language: Judge0Language;
  source: string;
  stdin?: string;
}): Promise<Judge0Result> {
  const url = process.env.JUDGE0_URL;
  const apiKey = process.env.JUDGE0_API_KEY;
  const apiHost = process.env.JUDGE0_API_HOST; // RapidAPI なら必須、self-hosted なら空でも OK
  if (!url || !apiKey) throw new Judge0DisabledError();

  if (!isJudge0Language(args.language)) {
    throw new Judge0RequestError(`unsupported language: ${args.language}`);
  }
  const srcBytes = Buffer.byteLength(args.source, "utf-8");
  const stdinBytes = args.stdin ? Buffer.byteLength(args.stdin, "utf-8") : 0;
  if (srcBytes > JUDGE0_MAX_SOURCE_BYTES || stdinBytes > JUDGE0_MAX_SOURCE_BYTES) {
    throw new Judge0RequestError(
      `source / stdin が大きすぎます (max ${JUDGE0_MAX_SOURCE_BYTES} bytes)`,
    );
  }

  const body = {
    language_id: languageId(args.language),
    source_code: toBase64(args.source),
    stdin: args.stdin ? toBase64(args.stdin) : "",
    wall_time_limit: JUDGE0_WALL_TIME_LIMIT_SEC,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-RapidAPI-Key": apiKey,
  };
  if (apiHost) headers["X-RapidAPI-Host"] = apiHost;

  const endpoint = `${url.replace(/\/$/, "")}/submissions?base64_encoded=true&wait=true&fields=stdout,stderr,status,time,memory,token`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JUDGE0_FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Judge0RequestError(`Judge0 timeout (>${JUDGE0_FETCH_TIMEOUT_MS}ms)`, 504);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Judge0RequestError(
      `Judge0 API error (${res.status}): ${text.slice(0, 200)}`,
      res.status,
    );
  }
  const data = (await res.json()) as {
    stdout?: string | null;
    stderr?: string | null;
    status?: { description?: string };
    time?: string | null;
    memory?: number | null;
    token: string;
  };
  return {
    stdout: fromBase64(data.stdout ?? null),
    stderr: fromBase64(data.stderr ?? null),
    status: data.status?.description ?? "Unknown",
    timeSec: data.time ? Number.parseFloat(data.time) : null,
    memoryKb: data.memory ?? null,
    token: data.token,
  };
}
