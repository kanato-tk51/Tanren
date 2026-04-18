/** Bottom tab bar の純粋ロジックを UI 層から切り離して unit test 可能にする
 *  (Vitest の environment: "node" なので React render を直接は叩かない)。
 */

export type NavTabId = "home" | "drill" | "insights";

export type NavTab = {
  id: NavTabId;
  href: string;
  label: string;
  matches: (pathname: string) => boolean;
};

export const NAV_TABS: NavTab[] = [
  { id: "home", href: "/", label: "Home", matches: (p) => p === "/" },
  {
    id: "drill",
    href: "/drill",
    label: "Drill",
    matches: (p) => p === "/drill" || p.startsWith("/drill/"),
  },
  {
    id: "insights",
    href: "/insights",
    label: "Insights",
    matches: (p) => p === "/insights" || p.startsWith("/insights/"),
  },
];

/** BottomNav を出さないルート (セッション中の没入画面 + 認証画面 + オンボーディング) */
export const NAV_HIDDEN_PREFIXES = ["/drill", "/custom", "/review", "/login", "/onboarding"];

export function isNavHidden(pathname: string): boolean {
  return NAV_HIDDEN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function activeTabId(pathname: string): NavTabId | null {
  for (const tab of NAV_TABS) {
    if (tab.matches(pathname)) return tab.id;
  }
  return null;
}
