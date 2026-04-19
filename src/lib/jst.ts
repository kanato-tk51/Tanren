/** Asia/Tokyo (JST, UTC+9) 固定の日付境界ヘルパ。
 *  MVP: 個人用 / 日本語 UI なので timezone 切替は未サポート。
 *  Home の「今日の進捗」と Insights History の「今日/直近 7 日」が同じ基準で
 *  切り替わるように、境界計算はここに一本化する。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 今日 00:00 JST を UTC Date として返す。 */
export function jstStartOfToday(now: Date = new Date()): Date {
  const nowJstMs = now.getTime() + JST_OFFSET_MS;
  const startOfTodayJstMs = Math.floor(nowJstMs / DAY_MS) * DAY_MS;
  return new Date(startOfTodayJstMs - JST_OFFSET_MS);
}

/** Insights History で使う「今日 / 直近 7 日」境界。
 *  weekAgo は今日も含めて 7 日になるように今日 00:00 JST から 6 日前。
 */
export function jstPeriodBounds(now: Date = new Date()): { today: Date; weekAgo: Date } {
  const today = jstStartOfToday(now);
  return {
    today,
    weekAgo: new Date(today.getTime() - 6 * DAY_MS),
  };
}
