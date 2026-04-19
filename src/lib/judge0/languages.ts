/** Judge0 CE 言語 ID (真実の源: https://github.com/judge0/judge0/blob/master/docs/languages.md)。
 *  RapidAPI 上の Judge0 CE も同じ ID を使う。MVP は 3 言語だけ対応、追加は必要になってから。
 */
export const JUDGE0_LANGUAGES = {
  python: 71, // Python 3.8.1
  typescript: 74, // TypeScript 3.7.4
  javascript: 63, // JavaScript Node.js 12.14.0
} as const;

export type Judge0Language = keyof typeof JUDGE0_LANGUAGES;

export function isJudge0Language(v: string): v is Judge0Language {
  return v in JUDGE0_LANGUAGES;
}

export function languageId(lang: Judge0Language): number {
  return JUDGE0_LANGUAGES[lang];
}
