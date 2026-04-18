import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * markdown ベースのプロンプトテンプレ読み込みと変数置換。
 *
 * フォーマット:
 *   ::: system
 *   ...
 *   :::
 *
 *   ::: user
 *   ...{{ variable }}...
 *   :::
 *
 * `buildMcqPrompt` 等のラッパがこの utility を使って markdown を単一のマスタとして扱う。
 */
export type SplitPrompt = {
  system: string;
  user: string;
};

const TEMPLATE_ROOT = join(process.cwd(), "prompts");
const cache = new Map<string, string>();

export function loadTemplate(relativePath: string): string {
  const full = join(TEMPLATE_ROOT, relativePath);
  let cached = cache.get(full);
  if (cached === undefined) {
    cached = readFileSync(full, "utf8");
    cache.set(full, cached);
  }
  return cached;
}

const SECTION_RE = /:::\s*(system|user)\s*\n([\s\S]*?)\n:::/g;

function extractSections(raw: string): SplitPrompt {
  const out: Partial<SplitPrompt> = {};
  for (const match of raw.matchAll(SECTION_RE)) {
    const [, kind, body] = match;
    if (kind === "system" || kind === "user") {
      out[kind] = body.trim();
    }
  }
  if (!out.system || !out.user) {
    throw new Error("prompt template must contain both ::: system and ::: user sections");
  }
  return out as SplitPrompt;
}

function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (full, key: string) => {
    if (!(key in vars)) {
      throw new Error(`unbound template variable: {{ ${key} }}`);
    }
    return vars[key];
  });
}

/** markdown テンプレを読み込み + 変数置換して system/user を返す */
export function renderTemplate(relativePath: string, vars: Record<string, string>): SplitPrompt {
  const raw = loadTemplate(relativePath);
  const { system, user } = extractSections(raw);
  return {
    system: substitute(system, vars),
    user: substitute(user, vars),
  };
}

/** テスト用に cache をクリアする (ホットリロード) */
export function __clearTemplateCache(): void {
  cache.clear();
}
